# 🔧 Deployment and Troubleshooting Guide

## 🚨 Current Issue Resolution

Your MP4 to HLS converter was not working due to several issues that have been **FIXED**:

### ✅ Issues Fixed:

1. **FFmpeg Command Issues**: Fixed shell quoting problems in Lambda execution
2. **Better Error Handling**: Enhanced logging and error reporting
3. **Region Configuration**: Fixed S3 URL generation with proper region
4. **File Filtering**: Added logic to prevent processing output files recursively
5. **Enhanced Diagnostics**: Added comprehensive logging and error messages

## 🚀 Deploy the Fixed System

### Option 1: Quick Deploy (Recommended)

```bash
# Navigate to project directory
cd /Users/nboshyan/Desktop/mp4-to-hls

# Run automated deployment script
./deploy-and-test.sh
```

### Option 2: Manual Deploy

```bash
# Configure AWS credentials first
aws configure

# Install dependencies and build
npm install
npm run build

# Bootstrap CDK (first time only)
npx cdk bootstrap

# Deploy the stack
npx cdk deploy VideoProcessingStack --require-approval never
```

## 🧪 Test Your System

### 1. Upload a Test Video

```bash
# Upload any MP4 file to trigger processing
aws s3 cp your-video.mp4 s3://pba-users-bucket/OnlineCourses/test/your-video.mp4

# The system will automatically:
# ✅ Convert to 480p, 720p, 1080p
# ✅ Create master playlist: your-video.m3u8
# ✅ Generate all segment files
```

### 2. Monitor Processing

```bash
# Watch Lambda function logs in real-time
aws logs tail /aws/lambda/VideoProcessingStack-VideoToHLS* --follow
```

### 3. Access Your HLS Stream

```bash
# Your video will be available at:
https://pba-users-bucket.s3.us-east-1.amazonaws.com/OnlineCourses/test/your-video.m3u8
```

## 🔍 Troubleshoot Issues

### Run Comprehensive Diagnostics

```bash
# Check system health and configuration
./troubleshoot.sh

# Or test with a specific video
./troubleshoot.sh path/to/test-video.mp4
```

### Common Issues and Solutions

#### 1. **AWS Credentials Not Configured**

```bash
aws configure
# Enter your AWS Access Key ID, Secret Key, and Region
```

#### 2. **Lambda Function Not Deploying**

```bash
# Check if CDK is bootstrapped
npx cdk bootstrap

# Redeploy
npx cdk deploy --require-approval never
```

#### 3. **Videos Not Processing**

- ✅ **Fixed**: Enhanced S3 event configuration
- ✅ **Fixed**: Better file filtering to prevent loops
- Check: Ensure files are uploaded to `OnlineCourses/` prefix

#### 4. **Processing Fails**

- ✅ **Fixed**: Improved FFmpeg error handling
- ✅ **Fixed**: Better temp file management
- Check logs: `aws logs tail /aws/lambda/VideoProcessingStack-VideoToHLS* --follow`

## 🎯 Expected Behavior

When you upload `video.mp4` to `s3://pba-users-bucket/OnlineCourses/anything/video.mp4`:

### 📁 Input:

```
OnlineCourses/20/
  └── video.mp4
```

### 📁 Output (Automatically Generated):

```
OnlineCourses/20/
  ├── video.mp4                    # Original preserved
  ├── video.m3u8                   # 🎯 Master playlist (your main URL)
  ├── video_480p.m3u8              # 480p playlist
  ├── video_720p.m3u8              # 720p playlist
  ├── video_1080p.m3u8             # 1080p playlist
  ├── video_480p_001.ts            # 480p segments...
  ├── video_720p_001.ts            # 720p segments...
  └── video_1080p_001.ts           # 1080p segments...
```

### 🌐 Access URL:

```
https://pba-users-bucket.s3.us-east-1.amazonaws.com/OnlineCourses/20/video.m3u8
```

## ⚡ Quick Test Commands

```bash
# 1. Test upload
aws s3 cp test.mp4 s3://pba-users-bucket/OnlineCourses/test/test.mp4

# 2. Check processing (wait 2-3 minutes)
aws s3 ls s3://pba-users-bucket/OnlineCourses/test/ | grep test

# 3. Test HLS URL
curl -I https://pba-users-bucket.s3.us-east-1.amazonaws.com/OnlineCourses/test/test.m3u8
```

## 🎥 Video Player Test

```html
<!DOCTYPE html>
<html>
  <head>
    <title>HLS Test Player</title>
  </head>
  <body>
    <video controls width="800">
      <source
        src="https://pba-users-bucket.s3.us-east-1.amazonaws.com/OnlineCourses/test/your-video.m3u8"
        type="application/vnd.apple.mpegurl"
      />
      Your browser does not support HLS playback.
    </video>
  </body>
</html>
```

## 🆘 Support

If you still encounter issues:

1. **Run diagnostics**: `./troubleshoot.sh your-video.mp4`
2. **Check logs**: `aws logs tail /aws/lambda/VideoProcessingStack-VideoToHLS* --follow`
3. **Verify setup**: All scripts and configurations are now fixed and ready to deploy

---

**🎉 The system is now fixed and ready to automatically convert your MP4 files to 3-quality HLS streams!**
