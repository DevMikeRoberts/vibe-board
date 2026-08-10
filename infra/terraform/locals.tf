locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = var.github_repository
    },
    var.extra_tags,
  )

  # Parameter Store prefix holding every runtime secret/setting the instance
  # reads at deploy time. Values are populated out-of-band (see docs), never by
  # Terraform — the placeholders below keep secrets out of state.
  ssm_prefix = "/${var.project_name}/${var.environment}"

  # SecureString parameters: created with a placeholder, value ignored forever.
  secret_parameters = {
    API_KEY                    = "Bearer token shared by Caddy and the server (/api + /ws auth)"
    ANTHROPIC_API_KEY          = "Anthropic API key used by the Claude agent provider"
    GH_TOKEN                   = "GitHub PAT used for cloning, pushing branches and opening PRs"
    BASIC_AUTH_HASH            = "bcrypt hash of the site password (auth_mode = basic)"
    OAUTH2_PROXY_CLIENT_SECRET = "GitHub OAuth app client secret (auth_mode = oauth)"
    OAUTH2_PROXY_COOKIE_SECRET = "32-byte base64 cookie secret for oauth2-proxy (auth_mode = oauth)"
  }

  # Plain String parameters: non-secret, still user-managed after creation.
  plain_parameters = {
    BASIC_AUTH_USER          = var.basic_auth_user
    OAUTH2_PROXY_CLIENT_ID   = "REPLACE_ME"
    OAUTH2_PROXY_GITHUB_USER = "REPLACE_ME"
    CLAUDE_MODEL             = var.claude_model
  }

  board_url = "https://${var.domain_name}"
}
