# ---------------------------------------------------------------------------
# Core naming / region
# ---------------------------------------------------------------------------

variable "aws_region" {
  description = "AWS region to deploy into. Keep every resource in one region — cross-region data transfer is not free."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short project slug used to name every resource."
  type        = string
  default     = "agentboard"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,20}$", var.project_name))
    error_message = "project_name must be lowercase alphanumeric/hyphen, 2-21 characters."
  }
}

variable "environment" {
  description = "Environment slug (prod, staging, ...). Part of every resource name and the SSM parameter prefix."
  type        = string
  default     = "prod"
}

variable "extra_tags" {
  description = "Additional tags merged into the provider default_tags."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# DNS / TLS
# ---------------------------------------------------------------------------

variable "domain_name" {
  description = "Fully-qualified hostname the board is served from, e.g. board.example.com."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\\.[a-z]{2,}$", var.domain_name))
    error_message = "domain_name must be a valid lowercase FQDN, e.g. board.example.com."
  }
}

variable "hosted_zone_name" {
  description = "Route 53 hosted zone that owns domain_name, e.g. example.com (no trailing dot)."
  type        = string
}

variable "create_hosted_zone" {
  description = "Create the Route 53 public hosted zone. Set false (default) to reuse an existing zone — a zone costs $0.50/month, so do not create a duplicate."
  type        = bool
  default     = false
}

variable "acme_email" {
  description = "Contact address Let's Encrypt uses for expiry warnings (Caddy issues the certificate on the instance)."
  type        = string
}

# ---------------------------------------------------------------------------
# Compute
# ---------------------------------------------------------------------------

variable "instance_type" {
  description = "EC2 instance type. t3.micro is the 12-month free-tier size; t3.small/t4g.small give the 2 GB that real agent runs want."
  type        = string
  default     = "t3.micro"
}

variable "instance_architecture" {
  description = "CPU architecture of the AMI and container images: x86_64 (t3.*) or arm64 (t4g.*). Must match the platform CI builds for."
  type        = string
  default     = "x86_64"

  validation {
    condition     = contains(["x86_64", "arm64"], var.instance_architecture)
    error_message = "instance_architecture must be x86_64 or arm64."
  }
}

variable "root_volume_size" {
  description = "Root EBS volume size in GiB (holds the OS and the Docker image cache)."
  type        = number
  default     = 20
}

variable "data_volume_size" {
  description = "Size in GiB of the persistent data EBS volume mounted at /data (SQLite DB, cloned repos, TLS certs). Kept across instance replacement."
  type        = number
  default     = 10
}

variable "swap_size_gb" {
  description = "Swap file size in GiB created on the root volume. Keeps a 1 GB instance alive under agent load; set 0 to disable."
  type        = number
  default     = 2
}

variable "compose_plugin_version" {
  description = "Docker Compose v2 plugin version installed on the instance (Amazon Linux 2023 has no compose package)."
  type        = string
  default     = "v2.32.4"
}

variable "enable_detailed_monitoring" {
  description = "EC2 detailed (1-minute) CloudWatch monitoring. Costs money — off by default."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Network access
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR for the dedicated VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidr" {
  description = "CIDR for the single public subnet the instance lives in."
  type        = string
  default     = "10.20.1.0/24"
}

variable "allowed_web_cidrs" {
  description = "CIDRs allowed to reach 80/443. Port 80 must stay open to 0.0.0.0/0 for the Let's Encrypt HTTP-01 challenge; narrow 443 here if you have static egress IPs."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "allowed_ssh_cidrs" {
  description = "CIDRs allowed to reach port 22. Empty by default — shell access goes through SSM Session Manager, which needs no inbound rule at all."
  type        = list(string)
  default     = []
}

variable "ssh_key_name" {
  description = "Optional existing EC2 key pair name for break-glass SSH. Null (default) means no key — use SSM Session Manager."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

variable "auth_mode" {
  description = "Edge login for the whole site: 'basic' (Caddy HTTP basic auth, zero external setup) or 'oauth' (oauth2-proxy + GitHub OAuth, allowlisted users)."
  type        = string
  default     = "basic"

  validation {
    condition     = contains(["basic", "oauth"], var.auth_mode)
    error_message = "auth_mode must be 'basic' or 'oauth'."
  }
}

variable "basic_auth_user" {
  description = "Username for auth_mode = basic. The password hash lives in SSM as BASIC_AUTH_HASH."
  type        = string
  default     = "admin"
}

variable "enable_container_mode" {
  description = "Mount the host Docker socket into the server so each task runs in its own agent container. Needs >= 2 GB RAM and grants the server control of the host daemon — off by default."
  type        = bool
  default     = false
}

variable "claude_model" {
  description = "Optional CLAUDE_MODEL override for agent sessions. Empty string means use the provider default."
  type        = string
  default     = "default"
}

variable "ecr_image_retention_count" {
  description = "Number of tagged images kept per ECR repository before the lifecycle policy expires the oldest."
  type        = number
  default     = 5
}

# ---------------------------------------------------------------------------
# GitHub Actions OIDC
# ---------------------------------------------------------------------------

variable "github_repository" {
  description = "owner/repo allowed to assume the deploy role via OIDC."
  type        = string
  default     = "DevMikeRoberts/vibe-board"
}

variable "github_allowed_subjects" {
  description = "OIDC `sub` claims allowed to assume the deploy role. Defaults to the default branch and the 'production' environment of github_repository."
  type        = list(string)
  default     = null
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub Actions OIDC provider in this account. Set false if the account already has one (only one per account is allowed)."
  type        = bool
  default     = true
}

variable "github_oidc_thumbprints" {
  description = "Certificate thumbprints for token.actions.githubusercontent.com. AWS no longer validates these for GitHub, but the API still accepts them."
  type        = list(string)
  default = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}
