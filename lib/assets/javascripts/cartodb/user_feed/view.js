var cdb = require('cartodb.js');
var ViewFactory = require('../common/view_factory');
var randomQuote = require('../common/view_helpers/random_quote');
var LikeView = require('../common/views/likes/view');
var MapCardPreview = require('../common/views/mapcard_preview');
var Visualizations = require('./feed_collection');

module.exports = cdb.core.View.extend({
  tagName: 'div',

  _PAGE: 1,
  _ITEMS_PER_PAGE: 8,

  _SMALL_WIDTH: 544,

  _CARD_HEIGHT: 170,
  _LOADER_TITLE: 'Loading visualizations',

  events: {
    'click .js-more': '_onClickMore'
  },

  initialize: function() {
    _.bindAll(this, '_initLike', '_onFetchError', '_onWindowResize', '_renderStaticMaps');

    this.maps = [];

    this._initTemplates();
    this._initModels();
    this._initBindings();
  },

  render: function() {
    this.$el.html(this.template());
    this._renderLoader();
    this._fetchItems({ page: this._PAGE });

    return this;
  },

  _onWindowResize: function() {
    var width = $(window).width();

    if (width <= this._SMALL_WIDTH) {
      this.model.set('size', 'small');
    } else {
      this.model.set('size', 'big');
    }

    this._renderStaticMaps();
  },

  _initTemplates: function() {
    this.template = cdb.templates.getTemplate('user_feed/template');
    this.mapTemplate = cdb.templates.getTemplate('user_feed/map_item_template');
    this.datasetTemplate = cdb.templates.getTemplate('user_feed/dataset_item_template');
    this.loaderTemplatePath = 'user_feed/loading';
    this.emptyTemplatePath = 'user_feed/empty';
    this.errorTemplatePath = 'user_feed/error';
  },

  _initModels: function() {
    var size = 'big';
    var wWidth = $(window).width();

    if (wWidth <= this._SMALL_WIDTH) {
      size = 'small';
    }

    this.model = new cdb.Backbone.Model({
      vis_count: 0,
      type: '',
      size: size,
      page: 0,
      order_by: 'likes'
    });

    this.collection = new Visualizations();
    this.collection.bind('reset', this._renderVisualizations, this);
    this._likeModels = new Backbone.Collection();
  },

  _initBindings: function() {
    var self = this;

    this.model.bind('change:show_more', this._onChangeShowMore, this);
    this.model.bind('change:show_loader', this._onChangeShowLoader, this);
    this.model.bind('change:show_mast', this._onChangeShowMast, this);
    this.model.bind('change:vis_count', this._onChangeVisCount, this);

    this.options.authenticatedUser.bind('change', function() {
      self._onAuthenticatedUserChange();
      self._initLikes();
    }, this);

    $(window).bind('resize', this._onWindowResize);
  },

  _onChangeVisCount: function() {
    if (this.model.get('vis_count') >= this.collection.total_entries) {
      this.model.set({ show_more: false });
    } else {
      this.model.set({ show_more: true });
    }
  },

  _onChangeShowMast: function() {
    if (this.model.get('show_mast')) {
      this.$('.js-mast').removeClass('is-hidden');
    } else {
      this.$('.js-mast').addClass('is-hidden');
    }
  },

  _onChangeShowLoader: function() {
    if (this.model.get('show_loader')) {
      this.loader.show();
    } else {
      this.loader.hide();
    }
  },

  _onChangeShowMore: function() {
    this.$('.js-more').toggleClass('is-hidden', !this.model.get('show_more'));
  },

  _renderLoader: function() {
    this.loader = ViewFactory.createByTemplate(this.loaderTemplatePath, {
      title: this._LOADER_TITLE,
      quote: randomQuote()
    });

    this.$el.append(this.loader.render().$el);
  },

  _renderError: function() {
    this.error = ViewFactory.createByTemplate(this.errorTemplatePath, {
    });

    this.$el.append(this.error.render().$el);
  },

  _renderEmpty: function() {
    this.empty = ViewFactory.createByTemplate(this.emptyTemplatePath, {
      name: config.user_name
    });

    this.$el.append(this.empty.render().$el);
  },

  _getDatasetSize: function(item) {
    var size = item.get('table').size;
    return size ? cdb.Utils.readablizeBytes(size, true).split(' ') : 0;
  },

  _getGeometryType: function(geomTypes) {
    if (geomTypes && geomTypes.length > 0) {
      var types = ['point', 'polygon', 'line', 'raster'];
      var geomType = geomTypes[0];

      return _.find(types, function(type) {
        return geomType.toLowerCase().indexOf(type) !== -1;
      });

    } else {
      return null;
    }
  },

  _renderVisualizations: function() {

    if (this.collection.length === 0) {
      this.model.set({ show_loader: false });
      this._renderEmpty();
      return;
    }

    this.model.set({ vis_count: this.model.get('vis_count') + this.collection.length, show_loader: false, show_more: true, show_filters: true, show_mast: true });

    this.collection.each(function(item) {
      var template = item.get('type') === 'derived' ? this.mapTemplate : this.datasetTemplate;
      var geomType = (item.get('table') && item.get('table').geometry_types) ? this._getGeometryType(item.get('table').geometry_types) : null;

      var owner = item.get('permission').owner;

      var el = template({
        vis: item.attributes,
        datasetSize: this._getDatasetSize(item),
        username: owner.username,
        avatar_url: owner.avatar_url,
        table_count: owner.table_count,
        maps_count: owner.maps_count,
        geomType: geomType,
        account_host: config.account_host
      });

      this.$('.js-items').append(el);

      var $item = this.$('.js-items').find('[data-vis-id="' + item.get('id') + '"]');

      if (item.get('type') === 'derived') {
        this.maps.push(item);
      }

      if (item.get('type') === 'derived' && !item.get('rendered_' + this.model.get('size'))) {
        this._renderStaticMap(item, $item);
      }

    }, this);

    this._initLikes();
  },

  _renderStaticMaps: function() {
    _.each(this.maps, function(item) {
      if (!item.get('rendered_' + this.model.get('size'))) {
        var $item = this.$('.js-items').find('[data-vis-id="' + item.get('id') + '"]');
        this._renderStaticMap(item, $item);
      }
    }, this);
  },

  _renderStaticMap: function(vis, $el) {

    var visId = vis.get('id');
    var username = vis.get('permission').owner.username;

    var width = 540;

    if (this.model.get('size') === 'small') {
      width = 288;
    }

    var className = 'is-' + this.model.get('size');

    if (visId && username) {

      vis.set('rendered_' + this.model.get('size'), true);

      new MapCardPreview({
        el: $el.find('.js-header'),
        width: width,
        height: this._CARD_HEIGHT,
        account_host: config.maps_api_template.replace(/https?:\/\/{user}\./, ''),
        username: username,
        visId: visId,
        className: className
      }).load();
    }
  },

  _initLikes: function() {
    this.collection.each(function(item) {
      var $item = this.$('.js-items').find('[data-vis-id="' + item.get('id') + '"]');
      this._initLike(item, $item.find('.js-like'));
    }, this);
  },

  _getLikesEndpoint: function(vis) {
    return '/api/v1/viz/' + vis.get('id') + '/like';
  },

  _initLike: function(vis, $el) {
    var likeable = this.options.authenticatedUser && this.options.authenticatedUser.get('username');

    if (likeable) {
      var url = this._getLikesEndpoint(vis);

      var likeModel = cdb.admin.Like.newByVisData({
        url: url,
        likeable: likeable,
        show_count: true,
        show_label: true,
        vis_id: vis.get('id'),
        likes: vis.get('likes')
      });

      if (likeable) {
        likeModel.fetch();
      }

      this._likeModels.push(likeModel);

      var likeView = new LikeView({
        el: $el,
        model: likeModel
      });

      likeView.render();
    }
  },

  _onAuthenticatedUserChange: function() {
    if (this.options.authenticatedUser.get('username')) {
      this._likeModels.each(function(model) {
        model.set('likeable', true);
        model.fetch();
      });
    }
  },

  _fetchItems: function(params) {
    var data = _.extend({
        types: 'table,derived',
        privacy: 'public',
        exclude_shared: 'true',
        per_page: this._ITEMS_PER_PAGE,
        order: 'updated_at'
      }, params);

    this.collection.fetch({
      data: data,
      error: this._onFetchError
    });
  },

  _onFetchError: function() {
    this.model.set({ show_loader: false });
    this._renderError();
  },

  _onClickMore: function(e) {
    this.killEvent(e);
    this.model.set({ show_more: false, show_loader: true });
    this._fetchItems({ page: ++this._PAGE });
  }
});
