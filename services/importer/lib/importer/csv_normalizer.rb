# encoding: utf-8
require 'csv'
require 'charlock_holmes'
require 'tempfile'
require 'fileutils'
require_relative './job'
require_relative './source_file'
require_relative './unp'

module CartoDB
  module Importer2
    class CsvNormalizer

      LINE_SIZE_FOR_CLEANING = 5000
      LINES_FOR_DETECTION   = 100       # How many lines to read?
      SAMPLE_READ_LIMIT     = 500000   # Read big enough sample bytes for the encoding sampling
      COMMON_DELIMITERS     = [',', "\t", ' ', ';']
      DELIMITER_WEIGHTS     = {','=>2, "\t"=>2, ' '=>1, ';'=>2}
      DEFAULT_DELIMITER     = ','
      DEFAULT_ENCODING      = 'UTF-8'
      DEFAULT_QUOTE         = '"'
      OUTPUT_DELIMITER      = ','       # Normalized CSVs will use this delimiter
      ENCODING_CONFIDENCE   = 28
      ACCEPTABLE_ENCODINGS  = %w{ ISO-8859-1 ISO-8859-2 UTF-8 }
      REVERSE_LINE_FEED     = "\x8D"


      def initialize(filepath, job=nil)
        @filepath = filepath
        @job      = job || Job.new
        @delimiter = nil
        @force_normalize = false
        @encoding = nil
      end

      def force_normalize
        @force_normalize = true
      end

      # @throws MalformedCSVException
      def run
        return self unless File.exists?(filepath)

        detect_delimiter

        begin
          return self unless (needs_normalization? || @force_normalize)
        rescue CSV::MalformedCSVError => ex
          raise MalformedCSVException.new(ex.message)
        end

        normalize(temporary_filepath)
        release
        File.rename(temporary_filepath, filepath)
        FileUtils.rm_rf(temporary_directory)
        self.temporary_directory = nil
        self
      end

      def detect_delimiter

        # Calculate variances of the N first lines for each delimiter, then grab the one that changes less
        @delimiter = DEFAULT_DELIMITER unless first_line

        lines_for_detection = Array.new

        LINES_FOR_DETECTION.times {
          line = stream.gets
          lines_for_detection << remove_quoted_strings(line) unless line.nil?
        }

        stream.rewind

        # Maybe gets was not able to discern line breaks, try manually:
        if lines_for_detection.size == 1
          lines_for_detection = lines_for_detection.first
          # Did it read as columns instead of rows?
          if lines_for_detection.class == Array
            lines_for_detection.first
          end
          # Carriage return without newline
          lines_for_detection = lines_for_detection.split("\x0D")
        end

        occurrences = Hash[
          COMMON_DELIMITERS.map { |delimiter| 
            [delimiter, lines_for_detection.map { |line| 
              line.count(delimiter) }] 
          }
        ]

        stream.rewind

        variances = Hash.new
        @delimiter = DEFAULT_DELIMITER
        
        use_variance = true
        occurrences.each { |key, values| 
          if values.length > 1
            variances[key] = sample_variance(values) unless values.first == 0
          elsif values.length == 1
            # If only detected a single line of data, cannot use variance
            variances[key] = values.first * DELIMITER_WEIGHTS[key]
            use_variance = false
          else
            use_variance = false
          end
        }

        if variances.length > 0
          if use_variance
            @delimiter = variances.sort {|a, b| a.last <=> b.last }.first.first
          else
            # Use whatever delimiter appears more and hope for the best
            @delimiter = variances.sort {|a, b| b.last <=> a.last }.first.first
          end
        end

        @delimiter
      end

      def self.supported?(extension)
        %w(.csv .tsv .txt).include?(extension)
      end

      def normalize(temporary_filepath)
        temporary_csv = ::CSV.open(temporary_filepath, 'w', col_sep: OUTPUT_DELIMITER)
        File.open(filepath, 'rb', external_encoding: encoding)
        .each_line(line_delimiter) { |line|
          row = parsed_line(line)
          next unless row
          temporary_csv << multiple_column(row)
        }

        temporary_csv.close

        @delimiter = OUTPUT_DELIMITER
      rescue ArgumentError, Encoding::UndefinedConversionError, Encoding::InvalidByteSequenceError => e
        raise EncodingDetectionError
      end

      def   parsed_line(line)
        ::CSV.parse_line(line.chomp.encode('UTF-8',
                         :fallback => {
                             REVERSE_LINE_FEED.force_encoding("Windows-1252") => ""
                         }), csv_options)
      rescue => e
        nil
      end

      def temporary_filepath(filename_prefix = '')
        File.join(temporary_directory, filename_prefix + File.basename(filepath))
      end

      def csv_options
        {
          col_sep:            delimiter,
          quote_char:         DEFAULT_QUOTE
        }
      end

      def line_delimiter
        windows_eol? ? "\r" : $/
      end

      def windows_eol?
        return false if first_line =~ /\n/
        !!(first_line =~ %r{\r})
      end

      def needs_normalization?
        (!ACCEPTABLE_ENCODINGS.include?(encoding))  ||
        (delimiter != DEFAULT_DELIMITER)            ||
        single_column?
      end

      def single_column?
        ::CSV.parse(first_line, csv_options).first.length < 2
      end

      def multiple_column(row)
        return row if row.length > 1
        row << nil
      end

      def delimiter
        @delimiter
      end

      def encoding
        return @encoding unless @encoding.nil?

        source_file = SourceFile.new(filepath)
        if source_file.encoding
          @encoding = source_file.encoding
        else
          data    = File.open(filepath, 'r')
          sample  = data.read(SAMPLE_READ_LIMIT)
          data.close

          result = CharlockHolmes::EncodingDetector.detect(sample)
          if result.fetch(:confidence, 0) < ENCODING_CONFIDENCE
            @encoding = DEFAULT_ENCODING
          else
            @encoding = result.fetch(:encoding, DEFAULT_ENCODING)
          end
        end

        @encoding
      rescue
        DEFAULT_ENCODING
      end

      def first_line
        return @first_line if @first_line
        stream.rewind
        @first_line ||= stream.gets
        stream.rewind
      end

      def release
        @stream.close
        @stream = nil
        @first_line = nil
        self
      end

      def stream
        @stream ||= File.open(filepath, 'rb')
      end

      attr_reader   :filepath
      alias_method  :converted_filepath, :filepath

      private

      def generate_temporary_directory
        self.temporary_directory = Unp.new.generate_temporary_directory.temporary_directory
        self
      end

      def temporary_directory
        generate_temporary_directory unless @temporary_directory
        @temporary_directory
      end

      def sum(items_list)
        items_list.inject(0){|accum, i| accum + i }
      end

      def mean(items_list)
        sum(items_list) / items_list.length.to_f
      end

      def sample_variance(items_list)
        m = mean(items_list)
        sum = items_list.inject(0){|accum, i| accum + (i-m)**2 }
        sum / (items_list.length - 1).to_f
      end

      def remove_quoted_strings(input)
        input.gsub(/"[^\\"]*"/, '')
      end

      attr_writer :temporary_directory

    end
  end
end

