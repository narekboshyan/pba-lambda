#!/bin/bash

# Monitor batch conversion progress
# Usage: ./monitor-conversion.sh pba-users-bucket OnlineCourses/16

BUCKET="$1"
PREFIX="$2"

if [ $# -ne 2 ]; then
    echo "Usage: $0 <bucket> <prefix>"
    echo "Example: $0 pba-users-bucket OnlineCourses/16"
    exit 1
fi

echo "🔍 Monitoring HLS conversion progress for s3://$BUCKET/$PREFIX/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Count original MP4 files
TOTAL_MP4S=$(aws s3 ls "s3://$BUCKET/$PREFIX/" --recursive | grep "\.mp4$" | wc -l)
echo "📹 Total MP4 files: $TOTAL_MP4S"

# Count master playlists (.m3u8 files that don't contain quality indicators)
CONVERTED=$(aws s3 ls "s3://$BUCKET/$PREFIX/" --recursive | grep "\.m3u8$" | grep -v "_480p\|_720p\|_1080p" | wc -l)
echo "✅ Converted (master playlists): $CONVERTED"

# Count quality playlists
PLAYLISTS_480P=$(aws s3 ls "s3://$BUCKET/$PREFIX/" --recursive | grep "_480p\.m3u8$" | wc -l)
PLAYLISTS_720P=$(aws s3 ls "s3://$BUCKET/$PREFIX/" --recursive | grep "_720p\.m3u8$" | wc -l)
PLAYLISTS_1080P=$(aws s3 ls "s3://$BUCKET/$PREFIX/" --recursive | grep "_1080p\.m3u8$" | wc -l)

echo "📱 480p playlists: $PLAYLISTS_480P"
echo "💻 720p playlists: $PLAYLISTS_720P"  
echo "🖥️  1080p playlists: $PLAYLISTS_1080P"

# Count total segments
SEGMENTS=$(aws s3 ls "s3://$BUCKET/$PREFIX/" --recursive | grep "\.ts$" | wc -l)
echo "🎬 Total segments: $SEGMENTS"

# Calculate progress
if [ $TOTAL_MP4S -gt 0 ]; then
    PROGRESS=$((CONVERTED * 100 / TOTAL_MP4S))
    echo "📊 Progress: $PROGRESS% ($CONVERTED/$TOTAL_MP4S)"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $CONVERTED -eq $TOTAL_MP4S ] && [ $CONVERTED -gt 0 ]; then
    echo "🎉 All conversions complete!"
    echo ""
    echo "🔗 Sample URLs:"
    aws s3 ls "s3://$BUCKET/$PREFIX/" --recursive | grep "\.m3u8$" | grep -v "_480p\|_720p\|_1080p" | head -3 | while read -r line; do
        file_path=$(echo "$line" | awk '{print $4}')
        echo "  https://$BUCKET.s3.us-east-1.amazonaws.com/$file_path"
    done
else
    echo "⏳ Conversion in progress..."
    echo "💡 Re-run this script to check progress: ./scripts/monitor-conversion.sh $BUCKET $PREFIX"
fi