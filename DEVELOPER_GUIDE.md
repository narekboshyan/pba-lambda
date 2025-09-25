# Developer Guide

This guide helps developers understand, modify, and extend the MP4 to HLS conversion service.

## Quick Reference

### Key Files to Know
- `scripts/batch-convert-keep-structure.sh` - **Reference implementation** (Lambda replicates this)
- `src/video-processing-handler.ts` - Lambda function (must match bash script exactly)
- `bin/app.ts` - Configuration (bucket name, prefix)
- `lib/video-processor.ts` - Infrastructure definition

### Core Principle
**The Lambda function must exactly replicate the bash script behavior.** Any changes to video processing logic should be made to both files.

## Development Workflow

### 1. Local Development Setup
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Validate infrastructure
npx cdk synth
```

### 2. Testing Changes
```bash
# Test FFmpeg commands locally first
./scripts/local-hls-convert.sh test-video.mp4 output/

# Test batch processing
./scripts/batch-convert-keep-structure.sh pba-users-bucket OnlineCourses/test

# Deploy to AWS for integration testing
npx cdk deploy --require-approval never
```

### 3. Common Modifications

#### Adding New Video Quality
1. **Update bash script first:**
```bash
# Add to scripts/batch-convert-keep-structure.sh
# Generate 4K
ffmpeg -i "$temp_input" -y \
  -vf "scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -preset fast -crf 18 -maxrate 8000k -bufsize 16000k \
  -c:a aac -b:a 192k -ac 2 -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "$temp_output/${video_name}_4k_%03d.ts" \
  "$temp_output/${video_name}_4k.m3u8" -loglevel error 2>/dev/null || return 1
```

2. **Update Lambda function to match:**
```typescript
// Add to src/video-processing-handler.ts
await generateQualityHLS(tempInput, tempOutput, videoName, {
  name: "4k",
  width: 3840,
  height: 2160,
  videoBitrate: "8000k",
  audioBitrate: "192k",
  bufferSize: "16000k",
  crf: 18,
});
```

3. **Update master playlist generation** in both files

#### Changing S3 Configuration
Update `bin/app.ts`:
```typescript
const bucketName = "new-bucket-name";
const bucketPrefix = "new-prefix/";
```

#### Modifying FFmpeg Parameters
1. Test changes in `scripts/local-hls-convert.sh` first
2. Update Lambda function to match exactly
3. Ensure both scripts produce identical output

### 4. Deployment
```bash
# Manual deployment
npx cdk deploy --require-approval never

# Auto-deployment: Push to main/develop branch
git push origin main
```

## Code Architecture

### Lambda Function Structure
```typescript
// Main handler - processes S3 events
export const handler = async (event: S3Event) => { ... }

// Convert MP4 to HLS - replicates bash script convert_mp4_to_hls function
async function convertMp4ToHls(bucket: string, s3Key: string) => { ... }

// Generate single quality - replicates bash script ffmpeg commands
async function generateQualityHLS(input, output, name, quality) => { ... }

// Create master playlist - replicates bash script cat > EOF
async function createMasterPlaylist(output, name) => { ... }

// Upload files - replicates bash script aws s3 cp commands
async function uploadHlsFiles(bucket, dir, temp, name) => { ... }

// Cleanup - replicates bash script rm -rf
async function cleanupFiles(tempInput, tempOutput) => { ... }
```

### CDK Infrastructure Structure
```typescript
// Main stack class
export class VideoProcessingStack extends Stack {
  // Lambda function with FFmpeg bundling
  private readonly videoProcessorFunction: lambdaNode.NodejsFunction;

  // S3 bucket reference (existing bucket)
  private readonly processingBucket: s3.IBucket;

  // IAM permissions setup
  private grantS3Permissions(): void { ... }

  // S3 event trigger configuration
  private setupS3EventTrigger(prefix?: string): void { ... }

  // CloudWatch monitoring
  private createMonitoringDashboard(): void { ... }
}
```

## FFmpeg Command Reference

### Current Quality Specifications
All commands use these common parameters:
- `-preset fast` - Encoding speed vs quality tradeoff
- `-hls_time 6` - 6-second segment duration
- `-hls_playlist_type vod` - Video on demand playlist
- `-loglevel error` - Minimal logging output

### Video Scaling Logic
All qualities use aspect ratio preservation with padding:
```bash
-vf "scale=WIDTH:HEIGHT:force_original_aspect_ratio=decrease,pad=WIDTH:HEIGHT:(ow-iw)/2:(oh-ih)/2"
```

This ensures:
- Video fits within target resolution
- Original aspect ratio maintained
- Black bars added if needed
- Consistent output dimensions

### Audio Processing
- **480p/720p**: AAC, 128k bitrate, 2 channels
- **1080p**: AAC, 192k bitrate, 2 channels
- Always stereo output regardless of source

## File Naming Conventions

### Input/Output Structure
```
Original: video.mp4
├── video.m3u8              # Master playlist
├── video_480p.m3u8         # 480p playlist
├── video_720p.m3u8         # 720p playlist
├── video_1080p.m3u8        # 1080p playlist
├── video_480p_001.ts       # 480p segment 1
├── video_480p_002.ts       # 480p segment 2
├── video_720p_001.ts       # 720p segment 1
└── video_1080p_001.ts      # 1080p segment 1
```

### Temporary File Naming (Lambda)
```
/tmp/
├── video_1234567890_1234.mp4    # Downloaded input (timestamp_pid)
└── video_hls_1234/              # Processing directory (pid)
    ├── video.m3u8               # Master playlist
    ├── video_480p.m3u8          # Quality playlists
    ├── video_480p_001.ts        # Video segments
    └── ...
```

## Debugging Guide

### Lambda Function Debugging
```bash
# View recent logs
aws logs tail /aws/lambda/VideoProcessingStack-VideoToHLS* --follow

# Check function configuration
aws lambda get-function --function-name VideoProcessingStack-VideoToHLS*

# Test with small video file first
aws s3 cp small-test.mp4 s3://pba-users-bucket/OnlineCourses/test/small-test.mp4
```

### Local Script Debugging
```bash
# Enable verbose FFmpeg output
# Temporarily remove -loglevel error from FFmpeg commands

# Test individual quality generation
ffmpeg -i test.mp4 -vf "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -preset fast -crf 23 -maxrate 1000k -bufsize 2000k \
  -c:a aac -b:a 128k -ac 2 -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "test_480p_%03d.ts" "test_480p.m3u8"
```

### Common Error Patterns

**Lambda timeout:**
- Video too long (>4 hours)
- Insufficient memory for high-resolution processing
- Network issues downloading from S3

**FFmpeg errors:**
- Corrupted source video
- Unsupported codec/format
- Insufficient temporary storage space

**S3 permission errors:**
- Lambda IAM role missing permissions
- Bucket not in same region as Lambda
- Cross-account access issues

## Performance Optimization

### Processing Speed Improvements
```bash
# Use faster preset (lower quality)
-preset veryfast  # Instead of -preset fast

# Use hardware acceleration (if available)
-c:v h264_nvenc   # NVIDIA GPU encoding
-c:v h264_videotoolbox  # macOS hardware encoding
```

### Memory Usage Optimization
```typescript
// Process qualities sequentially instead of parallel
for (const quality of videoQualities) {
  await generateQualityHLS(input, output, name, quality);
}
```

### Cost Optimization Strategies
1. **Intelligent quality selection** - Only generate qualities needed based on source resolution
2. **Segment duration** - Longer segments = fewer files = lower S3 costs
3. **Compression optimization** - Adjust CRF values for size vs quality tradeoff

## Testing Strategies

### Unit Testing
```bash
# Test individual functions
npm test

# Test FFmpeg commands locally
./scripts/local-hls-convert.sh test.mp4 output/
```

### Integration Testing
```bash
# Full pipeline test
aws s3 cp test.mp4 s3://pba-users-bucket/OnlineCourses/test/test.mp4

# Verify output structure
aws s3 ls s3://pba-users-bucket/OnlineCourses/test/ --recursive
```

### Performance Testing
```bash
# Test various video characteristics
./scripts/local-hls-convert.sh short-video.mp4 output/    # <5 min
./scripts/local-hls-convert.sh medium-video.mp4 output/   # 30 min
./scripts/local-hls-convert.sh long-video.mp4 output/     # 2 hours
```

## Deployment Strategies

### Development Environment
```bash
# Deploy with development context
npx cdk deploy --context environment=development
```

### Production Environment
- Use GitHub Actions for automated deployment
- Requires environment variables configured in GitHub
- Triggers on push to main/develop branches

### Rollback Strategy
```bash
# If deployment fails, rollback
aws cloudformation cancel-update-stack --stack-name VideoProcessingStack

# Or destroy and redeploy
npx cdk destroy
npx cdk deploy
```

## Monitoring and Alerting

### Key Metrics to Monitor
- **Lambda Duration** - Processing time per video
- **Lambda Errors** - Failed processing attempts
- **Lambda Throttles** - Concurrency limit hits
- **S3 Object Counts** - Input vs output files

### Setting Up Alerts
The CDK stack automatically creates:
- Error alarms (>= 1 error in 5 minutes)
- Duration alarms (> 10 minutes processing time)

### Custom Metrics
Add custom CloudWatch metrics:
```typescript
// In Lambda function
import { CloudWatch } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatch({});
await cloudwatch.putMetricData({
  Namespace: 'VideoProcessing',
  MetricData: [{
    MetricName: 'ProcessingTime',
    Value: processingTimeMs,
    Unit: 'Milliseconds'
  }]
});
```

## Security Best Practices

### IAM Permissions
- Use least privilege principle
- Separate roles for different environments
- Regular access reviews

### S3 Security
- Bucket policies for public read access (HLS playback requirement)
- Encryption at rest for source videos
- Access logging for audit trails

### Code Security
- No hardcoded credentials
- Environment variables for configuration
- Regular dependency updates

## Extending the System

### Adding New Output Formats
1. Update FFmpeg commands for new format
2. Modify upload logic for different content types
3. Update master playlist if needed

### Adding Webhooks/Notifications
```typescript
// Add to Lambda function after successful processing
import { SNS } from '@aws-sdk/client-sns';

const sns = new SNS({});
await sns.publish({
  TopicArn: process.env.NOTIFICATION_TOPIC,
  Message: JSON.stringify({
    video: videoName,
    status: 'completed',
    hlsUrl: masterPlaylistUrl
  })
});
```

### Adding Progress Tracking
Store processing state in DynamoDB and provide progress updates via API Gateway + Lambda.

---

This developer guide provides the essential knowledge for working with the MP4 to HLS conversion system. Remember: always maintain parity between bash script and Lambda function implementations.