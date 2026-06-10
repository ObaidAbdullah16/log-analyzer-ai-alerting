output "app_url" {
  description = "Custom domain URL for the application."
  value       = "https://${var.domain_name}"
}

output "load_balancer_dns_name" {
  description = "Public ALB DNS name."
  value       = aws_lb.app.dns_name
}

output "ecr_repository_url" {
  description = "ECR repository used by GitHub Actions."
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name for GitHub Actions."
  value       = aws_ecs_cluster.app.name
}

output "ecs_service_name" {
  description = "ECS service name for GitHub Actions."
  value       = aws_ecs_service.app.name
}

output "github_actions_environment" {
  description = "Values to mirror in the GitHub Actions workflow."
  value = {
    AWS_REGION     = var.aws_region
    ECR_REPOSITORY = aws_ecr_repository.app.name
    ECS_CLUSTER    = aws_ecs_cluster.app.name
    ECS_SERVICE    = aws_ecs_service.app.name
  }
}
