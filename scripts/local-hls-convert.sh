#!/bin/bash

# Local HLS Conversion Script
# Usage: ./local-hls-convert.sh input.mp4

if [ $# -eq 0 ]; then
    echo "Usage: $0 input.mp4"
    exit 1
fi

INPUT_FILE="$1"
VIDEO_NAME=$(basename "$INPUT_FILE" .mp4)
OUTPUT_DIR="${VIDEO_NAME}_hls"

echo "🎬 Converting $INPUT_FILE to HLS..."
echo "📁 Output directory: $OUTPUT_DIR"

# Create output directory structure
mkdir -p "$OUTPUT_DIR/segments"

# Generate 480p rendition
echo "🔄 Generating 480p rendition..."
ffmpeg -i "$INPUT_FILE" -y \
  -vf "scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -preset medium -crf 23 \
  -maxrate 1000k -bufsize 2000k \
  -c:a aac -b:a 128k -ac 2 \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_segment_filename "$OUTPUT_DIR/segments/${VIDEO_NAME}_480p_%03d.ts" \
  "$OUTPUT_DIR/${VIDEO_NAME}_480p.m3u8"

# Generate 720p rendition
echo "🔄 Generating 720p rendition..."
ffmpeg -i "$INPUT_FILE" -y \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -preset medium -crf 21 \
  -maxrate 2500k -bufsize 5000k \
  -c:a aac -b:a 128k -ac 2 \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_segment_filename "$OUTPUT_DIR/segments/${VIDEO_NAME}_720p_%03d.ts" \
  "$OUTPUT_DIR/${VIDEO_NAME}_720p.m3u8"

# Generate 1080p rendition
echo "🔄 Generating 1080p rendition..."
ffmpeg -i "$INPUT_FILE" -y \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -preset medium -crf 20 \
  -maxrate 5000k -bufsize 10000k \
  -c:a aac -b:a 192k -ac 2 \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_segment_filename "$OUTPUT_DIR/segments/${VIDEO_NAME}_1080p_%03d.ts" \
  "$OUTPUT_DIR/${VIDEO_NAME}_1080p.m3u8"

# Create master playlist
echo "📋 Creating master playlist..."
cat > "$OUTPUT_DIR/${VIDEO_NAME}.m3u8" << EOF
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=1128000,RESOLUTION=854x480,CODECS="avc1.42e01e,mp4a.40.2"
${VIDEO_NAME}_480p.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720,CODECS="avc1.42e01e,mp4a.40.2"
${VIDEO_NAME}_720p.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=5192000,RESOLUTION=1920x1080,CODECS="avc1.42e01f,mp4a.40.2"
${VIDEO_NAME}_1080p.m3u8
EOF

echo "✅ HLS conversion completed!"
echo "📂 Files created in: $OUTPUT_DIR/"
echo "🎥 Master playlist: $OUTPUT_DIR/${VIDEO_NAME}.m3u8"
echo "🔗 Quality playlists:"
echo "   - $OUTPUT_DIR/${VIDEO_NAME}_480p.m3u8"
echo "   - $OUTPUT_DIR/${VIDEO_NAME}_720p.m3u8" 
echo "   - $OUTPUT_DIR/${VIDEO_NAME}_1080p.m3u8"
echo ""
echo "🌐 To test locally, serve the directory with:"
echo "   python3 -m http.server 8000 --directory $OUTPUT_DIR"
echo "   Then open: http://localhost:8000/${VIDEO_NAME}.m3u8"