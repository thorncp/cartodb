var cdb = require('cartodb.js');

/**
 * Error details view, to be used together with an error object from an import model.
 *
 */

module.exports = cdb.core.View.extend({

  _TEMPLATES: {
    8001: 'common/views/size_error_details_upgrade_template',
    8005: 'common/views/layers_error_details_upgrade_template',
    default: 'common/views/error_details'
  },

  initialize: function() {
    this.user = this.options.user;
    this.err = this.options.err;
  },

  render: function() {
    // Preventing problems checking if the error_code is a number or a string
    // we make the comparision with only double =.
    var errorCode = this.err.error_code && parseInt(this.err.error_code);
    var upgradeUrl = cdb.config.get('upgrade_url');
    var userCanUpgrade = upgradeUrl && !cdb.config.get('custom_com_hosted') && (!this.user.isInsideOrg() || this.user.isOrgAdmin());
    var templatePath = this._TEMPLATES['default'];

    if (userCanUpgrade && this._TEMPLATES[errorCode]) {
      templatePath = this._TEMPLATES[errorCode];
    }

    var template = cdb.templates.getTemplate(templatePath);

    this.$el.html(
      template({
        errorCode: errorCode,
        title: this.err.title,
        text: this.err.what_about,
        itemQueueId: this.err.item_queue_id,
        userCanUpgrade: userCanUpgrade,
        showTrial: this.user.canStartTrial(),
        upgradeUrl: upgradeUrl
      })
    );

    return this;
  }

});
