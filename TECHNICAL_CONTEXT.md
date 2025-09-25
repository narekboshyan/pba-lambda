# Technical Context for AI Assistants

This document provides comprehensive technical context for Claude, GitHub Copilot, and other AI assistants working with this codebase.

## Repository Purpose

This is a **MP4 to HLS video conversion service** that automatically converts MP4 videos to HTTP Live Streaming (HLS) format for adaptive streaming. The system is designed to be triggered automatically when MP4 files are uploaded to specific S3 locations.

## Core Technology Stack

- **AWS CDK v2** - Infrastructure as Code
- **AWS Lambda** - Serverless compute for video processing
- **Node.js 20.x** - Runtime environment
- **TypeScript** - Primary programming language
- **FFmpeg** - Video processing engine (pure FFmpeg, NOT AWS MediaConvert)
- **AWS S3** - Object storage for videos and HLS files
- **GitHub Actions** - CI/CD pipeline

## Key Design Principles

### 1. Exact Script Replication
The Lambda function (`src/video-processing-handler.ts`) is designed to **exactly replicate** the behavior of the bash script (`scripts/batch-convert-keep-structure.sh`). This means:
- Same FFmpeg commands with identical parameters
- Same file naming conventions
- Same directory structure
- Same error handling approach

### 2. Original File Preservation
**CRITICAL**: This system NEVER deletes original MP4 files. The lambda only processes and creates HLS files alongside the original MP4.

### 3. Pure FFmpeg Implementation
This service uses **pure FFmpeg** processing, NOT AWS MediaConvert. This was an explicit design decision for:
- Cost control (FFmpeg is free)
- Full control over encoding parameters
- Consistency between local scripts and cloud processing

## File Structure and Responsibilities

```
mp4-to-hls/
├── src/
│   └── video-processing-handler.ts     # Main Lambda function - replicates bash script exactly
├── lib/
│   └── video-processor.ts              # CDK infrastructure definition
├── bin/
│   └── app.ts                          # CDK app entry point with bucket/prefix configuration
├── scripts/
│   ├── batch-convert-keep-structure.sh # REFERENCE IMPLEMENTATION - Lambda replicates this
│   ├── local-hls-convert.sh           # Local development/testing script
│   └── fix-s3-cors.sh                 # S3 CORS setup for HLS playback
└── .github/workflows/
    └── deploy.yml                     # Auto-deployment via GitHub Actions
```

## Current Configuration

### Target Environment
- **S3 Bucket**: `pba-users-bucket`
- **Trigger Prefix**: `OnlineCourses/` (matches any subdirectory like `OnlineCourses/20/`)
- **Region**: `us-east-1`
- **File Filter**: `.mp4` files only

### Video Processing Specifications
The system generates exactly **3 quality levels** with these specifications:

#### 480p Quality
- Resolution: 854x480 (with aspect ratio preservation and padding)
- Video: H.264, CRF 23, 1000k max bitrate, 2000k buffer
- Audio: AAC, 128k bitrate, 2 channels
- Segments: 6-second duration
- Output: `video_480p.m3u8` + `video_480p_001.ts`, `video_480p_002.ts`, etc.

#### 720p Quality
- Resolution: 1280x720 (with aspect ratio preservation and padding)
- Video: H.264, CRF 21, 2500k max bitrate, 5000k buffer
- Audio: AAC, 128k bitrate, 2 channels
- Segments: 6-second duration
- Output: `video_720p.m3u8` + `video_720p_001.ts`, `video_720p_002.ts`, etc.

#### 1080p Quality
- Resolution: 1920x1080 (with aspect ratio preservation and padding)
- Video: H.264, CRF 20, 5000k max bitrate, 10000k buffer
- Audio: AAC, 192k bitrate, 2 channels
- Segments: 6-second duration
- Output: `video_1080p.m3u8` + `video_1080p_001.ts`, `video_1080p_002.ts`, etc.

#### Master Playlist
- File: `video.m3u8` (same name as original MP4 but .m3u8 extension)
- Contains references to all three quality levels
- Uses standard HLS adaptive streaming format

## Lambda Function Architecture

### Processing Flow
1. **S3 Event Trigger** - MP4 upload triggers Lambda
2. **Download** - Copy MP4 from S3 to Lambda's `/tmp` directory
3. **FFmpeg Processing** - Generate 3 quality levels sequentially
4. **Master Playlist Creation** - Generate adaptive streaming playlist
5. **Upload** - Copy all HLS files back to S3 (same directory as original MP4)
6. **Cleanup** - Remove temporary files from Lambda

### Function Configuration
- **Memory**: 3008 MB (maximum for performance)
- **Timeout**: 15 minutes (maximum)
- **Runtime**: Node.js 20.x
- **Architecture**: x86_64
- **Environment Variables**:
  - `FFMPEG_PATH`: `./ffmpeg` (bundled binary)
  - `VIDEO_PROCESSING_BUCKET`: `pba-users-bucket`
  - `LOG_LEVEL`: `INFO`
  - `NODE_OPTIONS`: `--max-old-space-size=2048`

### Lambda Limitations
- **Max processing time**: 15 minutes
- **Max memory**: 3008 MB
- **Temp storage**: 10 GB (/tmp)
- **Suitable for**: Videos up to ~4 hours duration

## Critical Implementation Details

### FFmpeg Command Replication
The Lambda function must use EXACTLY the same FFmpeg commands as the bash script. Example for 1080p:

```bash
ffmpeg -i input.mp4 -y \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -preset fast -crf 20 \
  -maxrate 5000k -bufsize 10000k \
  -c:a aac -b:a 192k -ac 2 \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_segment_filename "video_1080p_%03d.ts" \
  "video_1080p.m3u8"
```

### File Naming Convention
- Original: `video.mp4`
- Master playlist: `video.m3u8`
- Quality playlists: `video_480p.m3u8`, `video_720p.m3u8`, `video_1080p.m3u8`
- Video segments: `video_480p_001.ts`, `video_720p_001.ts`, `video_1080p_001.ts`, etc.

### S3 Upload Specifications
The Lambda must replicate the exact S3 upload behavior from the bash script:

**Master and Quality Playlists (.m3u8 files):**
- Content-Type: `application/vnd.apple.mpegurl`
- Cache-Control: `no-cache`

**Video Segments (.ts files):**
- Content-Type: `video/mp2t`
- Cache-Control: `max-age=31536000`

### Error Handling Philosophy
The system should be robust but fail gracefully:
- Log all FFmpeg errors with full stdout/stderr
- Clean up temporary files on both success and failure
- Never leave partial processing results
- Return meaningful error messages for debugging

## Development Patterns

### When Modifying Lambda Function
If you need to modify the Lambda function, remember:

1. **Maintain bash script parity** - Any changes should be reflected in both Lambda and bash script
2. **Test locally first** - Use the local scripts for testing
3. **Preserve file structure** - HLS files must be in same directory as original MP4
4. **Never delete originals** - Original MP4 files must never be deleted
5. **Match FFmpeg parameters exactly** - Quality, bitrates, resolutions must match bash script

### Common Development Tasks

**Adding new video quality:**
1. Add to bash script first
2. Update Lambda function to match
3. Update master playlist generation
4. Test with local script before deploying

**Changing S3 bucket/prefix:**
1. Update `bin/app.ts` configuration
2. Update GitHub Actions environment variables
3. Redeploy infrastructure

**Debugging processing issues:**
1. Check CloudWatch Logs for Lambda execution
2. Test equivalent command with local bash script
3. Verify S3 permissions and bucket configuration

## Infrastructure Components

### CDK Stack Resources
The `lib/video-processor.ts` creates:

**Lambda Function:**
- Function with FFmpeg binary bundled
- IAM role with S3 read/write permissions
- CloudWatch log group with 7-day retention

**S3 Integration:**
- Event notification configuration
- Lambda permissions for S3 to invoke function
- Bucket policy for public read access (HLS playback requirement)

**Monitoring:**
- CloudWatch Dashboard with Lambda metrics
- Error alarms for failed processing
- Duration alarms for long-running jobs

### GitHub Actions Integration
The workflow (`.github/workflows/deploy.yml`) handles:
- Automatic deployment on push to `main`/`develop`
- CDK bootstrap and deployment
- Environment-specific configuration
- Failure notifications and cleanup

## Performance Characteristics

### Processing Times (Typical)
- **480p**: ~2-3 minutes per hour of video
- **720p**: ~3-4 minutes per hour of video
- **1080p**: ~5-6 minutes per hour of video
- **Total**: ~10-13 minutes per hour of source video

### Resource Usage
- **CPU**: High during FFmpeg processing
- **Memory**: Scales with video resolution and complexity
- **Storage**: Temporary storage for download + processing + upload
- **Network**: S3 download/upload bandwidth

### Cost Factors
- **Lambda compute time** (scales with video duration)
- **S3 storage** (source + HLS files, ~3x original size)
- **S3 data transfer** (minimal for same-region processing)

## Security Considerations

### IAM Permissions
The Lambda function has minimal required permissions:
- S3 GetObject/PutObject for specified bucket
- CloudWatch Logs creation and writing
- CloudWatch Metrics publishing

### S3 Security
- HLS files must be publicly readable for streaming
- Original MP4 files inherit bucket default permissions
- CORS configuration required for browser-based playback

### Secrets Management
- AWS credentials stored in GitHub Secrets (production environment)
- No hardcoded credentials in code
- Environment-specific configuration via CDK context

## Common Issues and Solutions

### Lambda Timeout
**Problem**: Videos longer than ~4 hours timeout
**Solution**: Pre-process longer videos or use alternative architecture (ECS/Batch)

### FFmpeg Memory Issues
**Problem**: High-resolution videos exceed Lambda memory
**Solution**: Already using maximum Lambda memory (3008 MB)

### S3 Permission Errors
**Problem**: Lambda cannot read/write S3 objects
**Solution**: Check IAM role permissions and bucket policies

### FFmpeg Binary Issues
**Problem**: FFmpeg not found or not executable
**Solution**: Binary is bundled via CDK, check bundling configuration

## Testing Strategy

### Local Testing
Use the bash script for testing FFmpeg commands:
```bash
./scripts/local-hls-convert.sh test-video.mp4 output/
```

### Integration Testing
Upload test video to S3 and monitor Lambda execution:
```bash
aws s3 cp test.mp4 s3://pba-users-bucket/OnlineCourses/test/test.mp4
aws logs tail /aws/lambda/VideoProcessingStack-VideoToHLS* --follow
```

### Performance Testing
Test with various video durations and resolutions to verify processing times and resource usage.

## Future Considerations

### Scalability
- Current design handles moderate video processing loads
- For high-volume processing, consider ECS Fargate or AWS Batch
- Concurrent Lambda executions may hit account limits

### Enhanced Features
- Additional quality levels (240p, 4K)
- Different encoding presets (quality vs speed tradeoffs)
- Audio-only HLS streams
- Video thumbnail generation
- Progress webhooks/notifications

### Cost Optimization
- Spot instances for batch processing
- Intelligent quality selection based on source resolution
- Compression optimization for storage costs

---

This technical context should provide comprehensive understanding for AI assistants working with this codebase. The key principle is maintaining exact parity between the bash script reference implementation and the Lambda function, while preserving original files and using pure FFmpeg processing.