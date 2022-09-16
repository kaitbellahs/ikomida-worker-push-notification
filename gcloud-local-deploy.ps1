Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSDefaultParameterValues['*:ErrorAction']='Stop'
function ThrowOnNativeFailure {
    if (-not $?)
    {
        throw 'Native Failure'
    }
}
$nocache=""
if($args.count -gt 0){
    $nocache=$args[0]
}
$env:GOOGLE_SERVICE_ACCOUNT="REMOVED_GCP_SERVICE_ACCOUNT_KEY"
yarn glogin
ThrowOnNativeFailure
yarn add @ikomida/shared-backend@latest
ThrowOnNativeFailure
docker build -t us-central1-docker.pkg.dev/ikomida-prod/docker/notification-worker-image:latest . --build-arg GOOGLE_SERVICE_ACCOUNT="$env:GOOGLE_SERVICE_ACCOUNT"  --build-arg NODEENV=devlopment $nocache
ThrowOnNativeFailure
docker push us-central1-docker.pkg.dev/ikomida-prod/docker/notification-worker-image:latest
ThrowOnNativeFailure
kubectl -n ikomida delete deploy notification-worker
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml