#!/bin/bash

# Troubleshoot MP4 to HLS Converter
# Usage: ./troubleshoot.sh [optional-test-video.mp4]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }

TEST_VIDEO="$1"
BUCKET_NAME="pba-users-bucket"
BUCKET_PREFIX="OnlineCourses/"

log_info "🔍 Troubleshooting MP4 to HLS Converter"

# 1. Check AWS credentials
echo ""
log_info "1. Checking AWS credentials..."
if aws sts get-caller-identity &> /dev/null; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    REGION=$(aws configure get region)
    log_success "AWS credentials OK - Account: $ACCOUNT_ID, Region: $REGION"
else
    log_error "AWS credentials not configured or invalid"
    echo "   Fix: Run 'aws configure' with valid credentials"
    exit 1
fi

# 2. Check if Lambda function exists
echo ""
log_info "2. Checking Lambda function..."
FUNCTION_NAME=$(aws cloudformation describe-stacks \
    --stack-name VideoProcessingStack \
    --query 'Stacks[0].Outputs[?OutputKey==`VideoProcessorFunctionName`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -n "$FUNCTION_NAME" ]; then
    log_success "Lambda function found: $FUNCTION_NAME"
    
    # Check function configuration
    aws lambda get-function-configuration --function-name "$FUNCTION_NAME" \
        --query '{
            Runtime: Runtime,
            MemorySize: MemorySize,
            Timeout: Timeout,
            LastModified: LastModified
        }' --output table
        
else
    log_error "Lambda function not found"
    echo "   Fix: Deploy the stack with './deploy-and-test.sh'"
    exit 1
fi

# 3. Check S3 bucket existence and permissions
echo ""
log_info "3. Checking S3 bucket..."
if aws s3api head-bucket --bucket "$BUCKET_NAME" &> /dev/null; then
    log_success "S3 bucket '$BUCKET_NAME' exists and accessible"
else
    log_error "S3 bucket '$BUCKET_NAME' not accessible"
    echo "   Fix: Check bucket name and permissions"
    exit 1
fi

# 4. Check S3 event notification configuration
echo ""
log_info "4. Checking S3 event notifications..."
EVENT_CONFIG=$(aws s3api get-bucket-notification-configuration --bucket "$BUCKET_NAME" 2>/dev/null || echo "{}")

if echo "$EVENT_CONFIG" | grep -q "LambdaConfigurations"; then
    log_success "S3 event notifications configured"
    echo "$EVENT_CONFIG" | jq '.LambdaConfigurations[] | {
        Id: .Id,
        Filter: .Filter,
        Events: .Events
    }' 2>/dev/null || echo "   (Raw config: partial view available)"
else
    log_warning "No Lambda event notifications found on S3 bucket"
    echo "   This could mean the CDK deployment didn't complete successfully"
fi

# 5. Test Lambda function directly
echo ""
log_info "5. Testing Lambda function with sample event..."
TEST_EVENT='{
  "Records": [
    {
      "eventVersion": "2.1",
      "eventSource": "aws:s3",
      "awsRegion": "'$REGION'",
      "eventTime": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'",
      "eventName": "ObjectCreated:Put",
      "s3": {
        "bucket": {
          "name": "'$BUCKET_NAME'"
        },
        "object": {
          "key": "'$BUCKET_PREFIX'test-video.mp4",
          "size": 1000000
        }
      }
    }
  ]
}'

echo "$TEST_EVENT" > /tmp/test-event.json

log_info "Invoking Lambda function..."
INVOKE_RESULT=$(aws lambda invoke \
    --function-name "$FUNCTION_NAME" \
    --payload file:///tmp/test-event.json \
    --cli-binary-format raw-in-base64-out \
    /tmp/lambda-response.json 2>&1)

if [ $? -eq 0 ]; then
    log_success "Lambda function invoked successfully"
    echo "Response:"
    cat /tmp/lambda-response.json | jq . 2>/dev/null || cat /tmp/lambda-response.json
else
    log_error "Lambda function invocation failed"
    echo "$INVOKE_RESULT"
fi

rm -f /tmp/test-event.json /tmp/lambda-response.json

# 6. Check recent Lambda logs
echo ""
log_info "6. Checking recent Lambda logs..."
LOG_GROUP="/aws/lambda/$FUNCTION_NAME"

if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" | grep -q "$LOG_GROUP"; then
    log_info "Recent log entries:"
    aws logs tail "$LOG_GROUP" --start-time -10m --format short | tail -20
else
    log_warning "No logs found for Lambda function"
fi

# 7. Test with actual video if provided
if [ -n "$TEST_VIDEO" ] && [ -f "$TEST_VIDEO" ]; then
    echo ""
    log_info "7. Testing with actual video: $TEST_VIDEO"
    
    TEST_KEY="${BUCKET_PREFIX}test/$(basename "$TEST_VIDEO")"
    
    log_info "Uploading test video to s3://$BUCKET_NAME/$TEST_KEY"
    if aws s3 cp "$TEST_VIDEO" "s3://$BUCKET_NAME/$TEST_KEY"; then
        log_success "Video uploaded successfully"
        
        log_info "Waiting for processing (30 seconds)..."
        sleep 30
        
        # Check if HLS files were created
        VIDEO_NAME=$(basename "$TEST_VIDEO" .mp4)
        MASTER_PLAYLIST_KEY="${BUCKET_PREFIX}test/${VIDEO_NAME}.m3u8"
        
        if aws s3api head-object --bucket "$BUCKET_NAME" --key "$MASTER_PLAYLIST_KEY" &> /dev/null; then
            log_success "✨ HLS conversion successful!"
            echo "   Master playlist: https://$BUCKET_NAME.s3.$REGION.amazonaws.com/$MASTER_PLAYLIST_KEY"
            
            # List all generated files
            log_info "Generated HLS files:"
            aws s3 ls "s3://$BUCKET_NAME/${BUCKET_PREFIX}test/" | grep "$VIDEO_NAME"
            
        else
            log_warning "HLS files not found yet. Check Lambda logs for processing status:"
            echo "   aws logs tail /aws/lambda/$FUNCTION_NAME --follow"
        fi
        
    else
        log_error "Failed to upload test video"
    fi
else
    echo ""
    log_info "7. No test video provided"
    echo "   To test with a video: ./troubleshoot.sh path/to/video.mp4"
fi

echo ""
log_info "🎯 Troubleshooting Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "• Lambda Function: $FUNCTION_NAME"
echo "• S3 Bucket: $BUCKET_NAME"
echo "• Expected Trigger: Upload .mp4 to s3://$BUCKET_NAME/${BUCKET_PREFIX}*"
echo "• Processing: Creates 480p, 720p, 1080p HLS variants"
echo "• Output: {video-name}.m3u8 master playlist"
echo ""
echo "📋 Next Steps:"
echo "1. Upload MP4: aws s3 cp video.mp4 s3://$BUCKET_NAME/${BUCKET_PREFIX}your-folder/video.mp4"
echo "2. Monitor logs: aws logs tail /aws/lambda/$FUNCTION_NAME --follow"
echo "3. Check output: https://$BUCKET_NAME.s3.$REGION.amazonaws.com/${BUCKET_PREFIX}your-folder/video.m3u8"