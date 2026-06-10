variable "aws_region" {
  description = "AWS region for the ECS service and load balancer."
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Name used for AWS resources."
  type        = string
  default     = "log-analyzer-ai-alerting"
}

variable "domain_name" {
  description = "Full custom domain name, for example logs.example.com."
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID for the parent domain."
  type        = string
}

variable "container_port" {
  description = "Port exposed by the container."
  type        = number
  default     = 8090
}

variable "desired_count" {
  description = "Number of running ECS tasks."
  type        = number
  default     = 1
}

variable "cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 256
}

variable "memory" {
  description = "Fargate task memory in MB."
  type        = number
  default     = 512
}

variable "container_environment" {
  description = "Plain environment variables for the container."
  type        = map(string)
  default = {
    ALERT_THRESHOLD_COUNT = "6"
    ALERT_GROWTH_PERCENT = "250"
    LLM_MODEL            = "gpt-4o-mini"
    LLM_API_URL          = "https://api.openai.com/v1/chat/completions"
  }
}

variable "ssm_secret_environment" {
  description = "Map of environment variable names to SSM SecureString parameter ARNs."
  type        = map(string)
  default     = {}
}
