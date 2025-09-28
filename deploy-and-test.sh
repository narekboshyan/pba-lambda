#!/bin/bash

# Deploy and Test MP4 to HLS Converter
# Usage: ./deploy-and-test.sh

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

log_info "🚀 Deploying MP4 to HLS Converter"

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    log_error "AWS credentials not configured. Please run: aws configure"
    exit 1
fi

log_success "AWS credentials configured"

# Check if CDK is bootstrapped
log_info "Checking CDK bootstrap status..."
if ! aws cloudformation describe-stacks --stack-name CDKToolkit &> /dev/null; then
    log_warning "CDK not bootstrapped. Running bootstrap..."
    npx cdk bootstrap
fi

# Install dependencies
log_info "Installing dependencies..."
npm install

# Build the project
log_info "Building TypeScript..."
npm run build

# Synthesize CloudFormation template
log_info "Synthesizing CDK template..."
npx cdk synth

# Deploy the stack
log_info "Deploying VideoProcessingStack..."
npx cdk deploy VideoProcessingStack --require-approval never

if [ $? -eq 0 ]; then
    log_success "Deployment completed successfully!"
    
    # Get the function name
    FUNCTION_NAME=$(aws cloudformation describe-stacks \
        --stack-name VideoProcessingStack \
        --query 'Stacks[0].Outputs[?OutputKey==`VideoProcessorFunctionName`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$FUNCTION_NAME" ]; then
        log_info "Lambda function deployed: $FUNCTION_NAME"
        
        # Check function configuration
        log_info "Function configuration:"
        aws lambda get-function-configuration --function-name "$FUNCTION_NAME" --query '{
            Runtime: Runtime,
            MemorySize: MemorySize,
            Timeout: Timeout,
            Environment: Environment.Variables
        }'
        
        # Check S3 bucket event configuration
        log_info "Checking S3 event configuration for pba-users-bucket..."
        aws s3api get-bucket-notification-configuration --bucket pba-users-bucket || log_warning "Could not get S3 notification configuration"
        
    else
        log_warning "Could not retrieve function name from stack outputs"
    fi
    
    echo ""
    log_success "🎉 Deployment complete!"
    echo ""
    log_info "To test the system:"
    echo "  1. Upload an MP4 file: aws s3 cp test.mp4 s3://pba-users-bucket/OnlineCourses/test/test.mp4"
    echo "  2. Check logs: aws logs tail /aws/lambda/$FUNCTION_NAME --follow"
    echo "  3. Expected output: https://pba-users-bucket.s3.amazonaws.com/OnlineCourses/test/test.m3u8"
    
else
    log_error "Deployment failed!"
    exit 1
fi