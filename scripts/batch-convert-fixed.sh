#!/bin/bash

# Batch Convert S3 MP4s to HLS - Keep Original Structure (Fixed for macOS)
# Usage: ./batch-convert-fixed.sh bucket prefix
# Example: ./batch-convert-fixed.sh pba-users-bucket OnlineCourses/16

set -e

# Configuration
CONCURRENT_JOBS=2
TEMP_DIR="/tmp/hls_batch_$(date +%s)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

if [ $# -ne 2 ]; then
    echo "❌ Usage: $0 <bucket> <prefix>"
    echo "Example: $0 pba-users-bucket OnlineCourses/16"
    exit 1
fi

BUCKET="$1"
PREFIX="$2"
PREFIX=$(echo "$PREFIX" | sed 's|/$||') # Remove trailing slash

log_info "🎬 Converting MP4s to HLS - Keeping Original Structure (Fixed Version)"
echo "🪣 Bucket: $BUCKET"
echo "📂 Prefix: $PREFIX"
echo ""

# Check dependencies
if ! command -v ffmpeg &> /dev/null || ! command -v aws &> /dev/null; then
    log_error "Missing dependencies. Install: brew install ffmpeg awscli"
    exit 1
fi

if ! aws sts get-caller-identity &> /dev/null; then
    log_error "AWS credentials not configured. Run: aws configure"
    exit 1
fi

mkdir -p "$TEMP_DIR"

# Find all MP4 files
log_info "🔍 Scanning for MP4 files..."
MP4_LIST="$TEMP_DIR/mp4_files.txt"
aws s3 ls "s3://$BUCKET/$PREFIX/" --recursive | grep "\.mp4$" | awk '{print $4}' > "$MP4_LIST"

if [ ! -s "$MP4_LIST" ]; then
    log_error "No MP4 files found in s3://$BUCKET/$PREFIX/"
    rm -rf "$TEMP_DIR"
    exit 1
fi

MP4_COUNT=$(wc -l < "$MP4_LIST")
log_success "Found $MP4_COUNT MP4 files"

echo "Files to process:"
head -5 "$MP4_LIST"
[ $MP4_COUNT -gt 5 ] && echo "... and $((MP4_COUNT - 5)) more"
echo ""

read -p "🤔 Convert $MP4_COUNT files? (y/N): " -n 1 -r
echo
[[ ! $REPLY =~ ^[Yy]$ ]] && { rm -rf "$TEMP_DIR"; exit 0; }

# Convert function
convert_mp4_to_hls() {
    local s3_key="$1"
    local video_dir=$(dirname "$s3_key")
    local video_name=$(basename "$s3_key" .mp4)
    local temp_input="$TEMP_DIR/${video_name}_$(date +%s)_$$.mp4"
    local temp_output="$TEMP_DIR/${video_name}_hls_$$"
    
    echo "🎬 [$video_name] Converting..."
    
    # Download MP4
    if ! aws s3 cp "s3://$BUCKET/$s3_key" "$temp_input" --quiet; then
        echo "❌ [$video_name] Download failed"
        return 1
    fi
    
    mkdir -p "$temp_output"
    
    # Generate 480p
    ffmpeg -i "$temp_input" -y \
      -vf "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2" \
      -c:v libx264 -preset fast -crf 23 -maxrate 1000k -bufsize 2000k \
      -c:a aac -b:a 128k -ac 2 -hls_time 6 -hls_playlist_type vod \
      -hls_segment_filename "$temp_output/${video_name}_480p_%03d.ts" \
      "$temp_output/${video_name}_480p.m3u8" -loglevel error 2>/dev/null || return 1
    
    # Generate 720p
    ffmpeg -i "$temp_input" -y \
      -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
      -c:v libx264 -preset fast -crf 21 -maxrate 2500k -bufsize 5000k \
      -c:a aac -b:a 128k -ac 2 -hls_time 6 -hls_playlist_type vod \
      -hls_segment_filename "$temp_output/${video_name}_720p_%03d.ts" \
      "$temp_output/${video_name}_720p.m3u8" -loglevel error 2>/dev/null || return 1
    
    # Generate 1080p
    ffmpeg -i "$temp_input" -y \
      -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
      -c:v libx264 -preset fast -crf 20 -maxrate 5000k -bufsize 10000k \
      -c:a aac -b:a 192k -ac 2 -hls_time 6 -hls_playlist_type vod \
      -hls_segment_filename "$temp_output/${video_name}_1080p_%03d.ts" \
      "$temp_output/${video_name}_1080p.m3u8" -loglevel error 2>/dev/null || return 1
    
    # Create master playlist with same name as MP4 (but .m3u8)
    cat > "$temp_output/${video_name}.m3u8" << EOF
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=1128000,RESOLUTION=854x480,CODECS="avc1.42e01e,mp4a.40.2"
${video_name}_480p.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720,CODECS="avc1.42e01e,mp4a.40.2"
${video_name}_720p.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=5192000,RESOLUTION=1920x1080,CODECS="avc1.42e01f,mp4a.40.2"
${video_name}_1080p.m3u8
EOF
    
    # Upload HLS files to the SAME directory as the original MP4
    echo "📤 [$video_name] Uploading HLS files..."
    
    # Upload master playlist
    aws s3 cp "$temp_output/${video_name}.m3u8" "s3://$BUCKET/$video_dir/${video_name}.m3u8" \
      --content-type "application/vnd.apple.mpegurl" --cache-control "no-cache" --quiet
    
    # Upload quality playlists  
    for quality in 480p 720p 1080p; do
        aws s3 cp "$temp_output/${video_name}_${quality}.m3u8" "s3://$BUCKET/$video_dir/${video_name}_${quality}.m3u8" \
          --content-type "application/vnd.apple.mpegurl" --cache-control "no-cache" --quiet
    done
    
    # Upload segments
    aws s3 cp "$temp_output/" "s3://$BUCKET/$video_dir/" --recursive --exclude "*.m3u8" \
      --content-type "video/mp2t" --cache-control "max-age=31536000" --quiet
    
    # Cleanup
    rm -rf "$temp_input" "$temp_output"
    
    echo "✅ [$video_name] Complete! https://$BUCKET.s3.us-east-1.amazonaws.com/$video_dir/${video_name}.m3u8"
    return 0
}

# Sequential processing with background jobs (works without GNU parallel)
log_info "🚀 Starting conversion (sequential with background jobs)..."

PIDS=()
ACTIVE_JOBS=0

process_file() {
    local file="$1"
    convert_mp4_to_hls "$file" &
    local pid=$!
    PIDS+=($pid)
    ((ACTIVE_JOBS++))
    
    # Wait if we've reached max concurrent jobs
    if [ $ACTIVE_JOBS -ge $CONCURRENT_JOBS ]; then
        wait ${PIDS[0]}
        PIDS=("${PIDS[@]:1}")  # Remove first PID
        ((ACTIVE_JOBS--))
    fi
}

# Process each file
PROCESSED=0
TOTAL=$(wc -l < "$MP4_LIST")

while IFS= read -r file; do
    ((PROCESSED++))
    echo "📋 Processing $PROCESSED/$TOTAL: $(basename "$file" .mp4)"
    process_file "$file"
done < "$MP4_LIST"

# Wait for remaining jobs to complete
log_info "🔄 Waiting for remaining jobs to complete..."
for pid in "${PIDS[@]}"; do
    wait $pid
done

echo ""
log_success "🎉 All conversions completed!"
echo ""
log_info "📁 Structure maintained - HLS files are alongside original MP4s"
log_info "🔗 Each video now has a master playlist: VIDEO_NAME.m3u8"
echo ""
log_info "Example URLs:"
head -3 "$MP4_LIST" | while read file; do
    dir=$(dirname "$file")
    name=$(basename "$file" .mp4)
    echo "  https://$BUCKET.s3.us-east-1.amazonaws.com/$dir/${name}.m3u8"
done

rm -rf "$TEMP_DIR"