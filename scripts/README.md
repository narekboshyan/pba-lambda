# Scripts

This folder contains utility scripts for video processing:

## Available Scripts

### `batch-convert-keep-structure.sh`
**Main batch conversion script** - Convert MP4s to HLS while keeping original structure
- Usage: `./batch-convert-keep-structure.sh bucket prefix`
- Example: `./batch-convert-keep-structure.sh pba-users-bucket OnlineCourses/20`
- This is the **reference implementation** that the Lambda function replicates

### `local-hls-convert.sh`
Local video conversion for testing (converts local MP4 files)

### `fix-s3-cors.sh`
Fix S3 bucket CORS settings for HLS playback

## Lambda Function
The Lambda function in `src/video-processing-handler.ts` implements the **exact same logic** as `batch-convert-keep-structure.sh` but runs automatically when MP4 files are uploaded to S3.

## Key Features (Both Scripts & Lambda)
- ✅ Preserves original MP4 files
- ✅ Creates HLS files in same directory as original MP4
- ✅ Generates 480p, 720p, 1080p qualities
- ✅ Uses pure FFmpeg (no MediaConvert)
- ✅ Same naming convention and structure