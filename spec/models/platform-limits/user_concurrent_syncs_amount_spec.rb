# coding: UTF-8

require_relative '../../spec_helper'
require_relative '../../../services/named-maps-api-wrapper/lib/named_maps_wrapper'

include CartoDB

describe CartoDB::PlatformLimits::Importer::UserConcurrentSyncsAmount do

  describe '#importer-limits' do
    it 'checks concurrent sync rate limit' do
      syncs_limit = CartoDB::PlatformLimits::Importer::UserConcurrentSyncsAmount::MAX_SYNCS_PER_USER

      limit = CartoDB::PlatformLimits::Importer::UserConcurrentSyncsAmount.new({
                                                                           user: $user_1,
                                                                           redis: {
                                                                             db: $users_metadata
                                                                           }
                                                                         })

      limit.peek.should eq 0
      limit.is_over_limit?.should eq false
      limit.peek.should eq 0

      limit.maximum_limit?.should eq syncs_limit
      limit.remaining_limit?.should eq syncs_limit

      limit.is_over_limit!.should eq false
      limit.peek.should eq 1

      limit.remaining_limit?.should eq syncs_limit-1

      limit.is_over_limit?.should eq false
      limit.is_over_limit!.should eq false
      limit.peek.should eq 2

      limit.is_over_limit?.should eq false
      # First increments, then checks
      limit.is_over_limit!.should eq true
      limit.peek.should eq 3
      limit.is_over_limit?.should eq true

      limit.is_over_limit!.should eq true
      limit.is_over_limit?.should eq true
      limit.peek.should eq 3
      limit.decrement!
      limit.peek.should eq 2
      limit.is_over_limit?.should eq false

      limit.decrement!
      limit.peek.should eq 1
      limit.decrement!
      limit.decrement!
      limit.decrement!
      limit.peek.should eq 0

      limit.is_within_limit!.should eq true
      limit.peek.should eq 1
      limit.is_within_limit!.should eq true
      limit.peek.should eq 2
      limit.is_within_limit!.should eq false
      limit.peek.should eq 3
    end
  end

end
