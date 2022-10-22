Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSDefaultParameterValues['*:ErrorAction']='Stop'
function ThrowOnNativeFailure {
    if (-not $?)
    {
        throw 'Native Failure'
    }
}
$PROJECT_ID="ikomida-dev"
if($args.count -gt 0){
    $PROJECT_ID=$args[0]
}
$nocache=""
if($args.count -gt 1){
    $nocache=$args[1]
}
$GOOGLE_SERVICE_ACCOUNT="REMOVED_GCP_SERVICE_ACCOUNT_KEY"
$GCLOUD_LOCATION="us-central1"
$NAME="push-notification"
$TYPE="worker"
$PACKAGE_VERSION="latest"
docker buildx build -o type=registry --cache-to=type=registry --cache-from=type=registry --build-arg BUILDKIT_INLINE_CACHE=1 -t us-central1-docker.pkg.dev/$PROJECT_ID/docker/$NAME-$TYPE-image:$PACKAGE_VERSION . --build-arg GOOGLE_SERVICE_ACCOUNT="$GOOGLE_SERVICE_ACCOUNT"  --build-arg NODEENV=devlopment --build-arg PROJECT_ID=$PROJECT_ID $nocache
kubectl -n ikomida-worker delete deploy $NAME-$TYPE

Get-ChildItem ".\k8s\" -Filter *.yaml | 
Foreach-Object {
    $content = Get-Content $_.FullName
    $content.replace('$PROJECT_ID', $PROJECT_ID).replace('$GCLOUD_LOCATION', $GCLOUD_LOCATION).replace('$NAME', $NAME).replace('$TYPE', $TYPE).replace('$PACKAGE_VERSION', $PACKAGE_VERSION) | kubectl apply -f -
}