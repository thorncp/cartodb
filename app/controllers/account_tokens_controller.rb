class AccountTokensController < ApplicationController
  layout 'frontend'

  ssl_required :enable

  def enable
    token = params[:id]
    render_404 and return unless token

    user = User.where(enable_account_token: token).first
    render_404 and return unless user

    user.enable_account_token = nil
    user.save

    @user = user
    flash.now[:success] = 'Account enabled, yikes!'
    render 'signup/account_enabled'
  end

end
