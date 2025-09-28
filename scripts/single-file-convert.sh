#!/bin/bash#!/bin/bash



# Single File Convert S3 MP4 to HLS - Keep Original Structure# Single File Convert S3 MP4 to HLS - Keep Original Structure

# Usage: ./single-file-convert.sh bucket file-path# Usage: ./single-file-convert.sh bucket file-path

# Example: ./single-file-convert.sh pba-users-bucket OnlineCourses/20/Level-19/Day-75/Video/1758906378015.mp4# Example: ./single-file-convert.sh pba-users-bucket OnlineCourses/20/Level-19/Day-75/Video/1758906378015.mp4



set -eset -e



# Configuration# Configuration

TEMP_DIR="/tmp/hls_single_$(date +%s)"TEMP_DIR="/tmp/hls_single_$(date +%s)"



# Colors# Colors

RED='\033[0;31m'RED='\033[0;31m'

GREEN='\033[0;32m'GREEN='\033[0;32m'

BLUE='\033[0;34m'BLUE='\033[0;34m'

NC='\033[0m'NC='\033[0m'



log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }

log_success() { echo -e "${GREEN}✅ $1${NC}"; }log_success() { echo -e "${GREEN}✅ $1${NC}"; }

log_error() { echo -e "${RED}❌ $1${NC}"; }log_error() { echo -e "${RED}❌ $1${NC}"; }



if [ $# -ne 2 ]; thenif [ $# -ne 2 ]; then

    echo "❌ Usage: $0 <bucket> <file-path>"    echo "❌ Usage: $0 <bucket> <file-path>"

    echo "Example: $0 pba-users-bucket OnlineCourses/20/Level-19/Day-75/Video/1758906378015.mp4"    echo "Example: $0 pba-users-bucket OnlineCourses/20/Level-19/Day-75/Video/1758906378015.mp4"

    exit 1    exit 1

fifi



BUCKET="$1"BUCKET="$1"

S3_KEY="$2"S3_KEY="$2"



# Extract directory and filename# Extract directory and filename

VIDEO_DIR=$(dirname "$S3_KEY")VIDEO_DIR=$(dirname "$S3_KEY")

VIDEO_NAME=$(basename "$S3_KEY" .mp4)VIDEO_NAME=$(basename "$S3_KEY" .mp4)



log_info "🎬 Converting single MP4 to HLS - Keeping Original Structure"log_info "🎬 Converting single MP4 to HLS - Keeping Original Structure"

echo "🪣 Bucket: $BUCKET"echo "🪣 Bucket: $BUCKET"

echo "📂 File: $S3_KEY"echo "📂 File: $S3_KEY"

echo ""echo ""



# Check dependencies# Check dependencies

if ! command -v ffmpeg &> /dev/null || ! command -v aws &> /dev/null; thenif ! command -v ffmpeg &> /dev/null || ! command -v aws &> /dev/null; then

    log_error "Missing dependencies. Install: brew install ffmpeg awscli"    log_error "Missing dependencies. Install: brew install ffmpeg awscli"

    exit 1    exit 1

fifi



if ! aws sts get-caller-identity &> /dev/null; thenif ! aws sts get-caller-identity &> /dev/null; then

    log_error "AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"    log_error "AWS credentials not configured"

    exit 1    exit 1

fifi



# Check if file exists# Check if file exists

if ! aws s3 ls "s3://$BUCKET/$S3_KEY" &> /dev/null; thenif ! aws s3 ls "s3://$BUCKET/$S3_KEY" &> /dev/null; then

    log_error "File not found: s3://$BUCKET/$S3_KEY"    log_error "File not found: s3://$BUCKET/$S3_KEY"

    exit 1    exit 1

fifi



mkdir -p "$TEMP_DIR"mkdir -p "$TEMP_DIR"



# Convert function (same as batch script)# Convert function (same as batch script)

convert_mp4_to_hls() {convert_mp4_to_hls() {

    local temp_input="$TEMP_DIR/${VIDEO_NAME}.mp4"    local temp_input="$TEMP_DIR/${VIDEO_NAME}.mp4"

    local temp_output="$TEMP_DIR/${VIDEO_NAME}_hls"    local temp_output="$TEMP_DIR/${VIDEO_NAME}_hls"

        

    log_info "🎬 [$VIDEO_NAME] Converting..."    log_info "🎬 [$VIDEO_NAME] Converting..."

        

    # Download MP4    # Download MP4

    if ! aws s3 cp "s3://$BUCKET/$S3_KEY" "$temp_input" --quiet; then    if ! aws s3 cp "s3://$BUCKET/$S3_KEY" "$temp_input" --quiet; then

        log_error "[$VIDEO_NAME] Download failed"        log_error "[$VIDEO_NAME] Download failed"

        return 1        return 1

    fi    fi

        

    mkdir -p "$temp_output"    mkdir -p "$temp_output"

        

    # Generate 480p    # Generate 480p

    ffmpeg -i "$temp_input" -y \    ffmpeg -i "$temp_input" -y \

      -vf "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2" \      -vf "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2" \

      -c:v libx264 -preset fast -crf 23 -maxrate 1000k -bufsize 2000k \      -c:v libx264 -preset fast -crf 23 -maxrate 1000k -bufsize 2000k \

      -c:a aac -b:a 128k -ac 2 -hls_time 6 -hls_playlist_type vod \      -c:a aac -b:a 128k -ac 2 -hls_time 6 -hls_playlist_type vod \

      -hls_segment_filename "$temp_output/${VIDEO_NAME}_480p_%03d.ts" \      -hls_segment_filename "$temp_output/${VIDEO_NAME}_480p_%03d.ts" \

      "$temp_output/${VIDEO_NAME}_480p.m3u8" -loglevel error 2>/dev/null || return 1      "$temp_output/${VIDEO_NAME}_480p.m3u8" -loglevel error 2>/dev/null || return 1

        

    # Generate 720p    # Generate 720p

    ffmpeg -i "$temp_input" -y \    ffmpeg -i "$temp_input" -y \

      -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \      -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \

      -c:v libx264 -preset fast -crf 21 -maxrate 2500k -bufsize 5000k \      -c:v libx264 -preset fast -crf 21 -maxrate 2500k -bufsize 5000k \

      -c:a aac -b:a 128k -ac 2 -hls_time 6 -hls_playlist_type vod \      -c:a aac -b:a 128k -ac 2 -hls_time 6 -hls_playlist_type vod \

      -hls_segment_filename "$temp_output/${VIDEO_NAME}_720p_%03d.ts" \      -hls_segment_filename "$temp_output/${VIDEO_NAME}_720p_%03d.ts" \

      "$temp_output/${VIDEO_NAME}_720p.m3u8" -loglevel error 2>/dev/null || return 1      "$temp_output/${VIDEO_NAME}_720p.m3u8" -loglevel error 2>/dev/null || return 1

        

    # Generate 1080p    # Generate 1080p

    ffmpeg -i "$temp_input" -y \    ffmpeg -i "$temp_input" -y \

      -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \      -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \

      -c:v libx264 -preset fast -crf 20 -maxrate 5000k -bufsize 10000k \      -c:v libx264 -preset fast -crf 20 -maxrate 5000k -bufsize 10000k \

      -c:a aac -b:a 192k -ac 2 -hls_time 6 -hls_playlist_type vod \      -c:a aac -b:a 192k -ac 2 -hls_time 6 -hls_playlist_type vod \

      -hls_segment_filename "$temp_output/${VIDEO_NAME}_1080p_%03d.ts" \      -hls_segment_filename "$temp_output/${VIDEO_NAME}_1080p_%03d.ts" \

      "$temp_output/${VIDEO_NAME}_1080p.m3u8" -loglevel error 2>/dev/null || return 1      "$temp_output/${VIDEO_NAME}_1080p.m3u8" -loglevel error 2>/dev/null || return 1

        

    # Create master playlist with same name as MP4 (but .m3u8)    # Create master playlist with same name as MP4 (but .m3u8)

    cat > "$temp_output/${VIDEO_NAME}.m3u8" << EOF    cat > "$temp_output/${VIDEO_NAME}.m3u8" << EOF

#EXTM3U#EXTM3U

#EXT-X-VERSION:3#EXT-X-VERSION:3



#EXT-X-STREAM-INF:BANDWIDTH=1128000,RESOLUTION=854x480,CODECS="avc1.42e01e,mp4a.40.2"#EXT-X-STREAM-INF:BANDWIDTH=1128000,RESOLUTION=854x480,CODECS="avc1.42e01e,mp4a.40.2"

${VIDEO_NAME}_480p.m3u8${VIDEO_NAME}_480p.m3u8



#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720,CODECS="avc1.42e01e,mp4a.40.2"#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720,CODECS="avc1.42e01e,mp4a.40.2"

${VIDEO_NAME}_720p.m3u8${VIDEO_NAME}_720p.m3u8



#EXT-X-STREAM-INF:BANDWIDTH=5192000,RESOLUTION=1920x1080,CODECS="avc1.42e01f,mp4a.40.2"#EXT-X-STREAM-INF:BANDWIDTH=5192000,RESOLUTION=1920x1080,CODECS="avc1.42e01f,mp4a.40.2"

${VIDEO_NAME}_1080p.m3u8${VIDEO_NAME}_1080p.m3u8

EOFEOF

        

    # Upload HLS files to the SAME directory as the original MP4    # Upload HLS files to the SAME directory as the original MP4

    log_info "📤 [$VIDEO_NAME] Uploading HLS files..."    log_info "📤 [$VIDEO_NAME] Uploading HLS files..."

        

    # Upload master playlist    # Upload master playlist

    aws s3 cp "$temp_output/${VIDEO_NAME}.m3u8" "s3://$BUCKET/$VIDEO_DIR/${VIDEO_NAME}.m3u8" \    aws s3 cp "$temp_output/${VIDEO_NAME}.m3u8" "s3://$BUCKET/$VIDEO_DIR/${VIDEO_NAME}.m3u8" \

      --content-type "application/vnd.apple.mpegurl" --cache-control "no-cache" --quiet      --content-type "application/vnd.apple.mpegurl" --cache-control "no-cache" --quiet

        

    # Upload quality playlists      # Upload quality playlists  

    for quality in 480p 720p 1080p; do    for quality in 480p 720p 1080p; do

        aws s3 cp "$temp_output/${VIDEO_NAME}_${quality}.m3u8" "s3://$BUCKET/$VIDEO_DIR/${VIDEO_NAME}_${quality}.m3u8" \        aws s3 cp "$temp_output/${VIDEO_NAME}_${quality}.m3u8" "s3://$BUCKET/$VIDEO_DIR/${VIDEO_NAME}_${quality}.m3u8" \

          --content-type "application/vnd.apple.mpegurl" --cache-control "no-cache" --quiet          --content-type "application/vnd.apple.mpegurl" --cache-control "no-cache" --quiet

    done    done

        

    # Upload segments    # Upload segments

    aws s3 cp "$temp_output/" "s3://$BUCKET/$VIDEO_DIR/" --recursive --exclude "*.m3u8" \    aws s3 cp "$temp_output/" "s3://$BUCKET/$VIDEO_DIR/" --recursive --exclude "*.m3u8" \

      --content-type "video/mp2t" --cache-control "max-age=31536000" --quiet      --content-type "video/mp2t" --cache-control "max-age=31536000" --quiet

        

    # Cleanup    # Cleanup

    rm -rf "$temp_input" "$temp_output"    rm -rf "$temp_input" "$temp_output"

        

    log_success "[$VIDEO_NAME] Complete! https://$BUCKET.s3.us-east-1.amazonaws.com/$VIDEO_DIR/${VIDEO_NAME}.m3u8"    log_success "[$VIDEO_NAME] Complete! https://$BUCKET.s3.us-east-1.amazonaws.com/$VIDEO_DIR/${VIDEO_NAME}.m3u8"

    return 0    return 0

}}



# Run conversion# Run conversion

log_info "🚀 Starting conversion..."log_info "🚀 Starting conversion..."

convert_mp4_to_hlsconvert_mp4_to_hls



echo ""echo ""

log_success "🎉 Conversion completed!"log_success "🎉 Conversion completed!"

echo ""echo ""

log_info "📁 Structure maintained - HLS files are alongside original MP4"log_info "📁 Structure maintained - HLS files are alongside original MP4"

log_info "🔗 Master playlist URL:"log_info "🔗 Master playlist URL:"

echo "  https://$BUCKET.s3.us-east-1.amazonaws.com/$VIDEO_DIR/${VIDEO_NAME}.m3u8"echo "  https://$BUCKET.s3.us-east-1.amazonaws.com/$VIDEO_DIR/${VIDEO_NAME}.m3u8"



rm -rf "$TEMP_DIR"rm -rf "$TEMP_DIR"