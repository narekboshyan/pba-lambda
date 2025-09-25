#!/bin/bash

# Fix S3 CORS Configuration for HLS Streaming
# Usage: ./fix-s3-cors.sh

BUCKET_NAME="pba-test-mediaconvert"

echo "🔧 Configuring S3 CORS for HLS streaming..."
echo "🪣 Bucket: $BUCKET_NAME"
echo ""

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Install with: brew install awscli"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Run: aws configure"
    exit 1
fi

# Create CORS configuration
cat > cors-config.json << EOF
{
    "CORSRules": [
        {
            "ID": "HLSStreamingRule",
            "AllowedHeaders": [
                "*"
            ],
            "AllowedMethods": [
                "GET",
                "HEAD"
            ],
            "AllowedOrigins": [
                "*"
            ],
            "ExposeHeaders": [
                "ETag",
                "Content-Length",
                "Content-Type"
            ],
            "MaxAgeSeconds": 3000
        }
    ]
}
EOF

echo "📋 CORS configuration created:"
cat cors-config.json
echo ""

# Apply CORS configuration
echo "🔧 Applying CORS configuration to bucket..."
aws s3api put-bucket-cors --bucket "$BUCKET_NAME" --cors-configuration file://cors-config.json

if [ $? -eq 0 ]; then
    echo "✅ CORS configuration applied successfully!"
else
    echo "❌ Failed to apply CORS configuration. Check your permissions."
    rm cors-config.json
    exit 1
fi

echo ""
echo "🔍 Verifying CORS configuration..."
aws s3api get-bucket-cors --bucket "$BUCKET_NAME"

# Clean up
rm cors-config.json

echo ""
echo "🎉 S3 CORS configuration completed!"
echo "🌐 Your HLS streams should now work in web browsers."
echo ""
echo "🧪 Test your HLS URL now:"
echo "   https://$BUCKET_NAME.s3.us-east-1.amazonaws.com/Level-8/Day-20/Video/1742584680884.m3u8"