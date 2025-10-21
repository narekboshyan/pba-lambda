#!/bin/bash

# Delete all .m3u8 and .ts files (HLS content) from S3 bucket path
# Usage: ./delete-m3u8-files.sh bucket prefix [--confirm]
# Example: ./delete-m3u8-files.sh pba-users-bucket OnlineCourses/16 --confirm

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

if [ $# -lt 2 ]; then
    echo "Usage: $0 <bucket> <prefix> [--confirm]"
    echo "Example: $0 pba-users-bucket OnlineCourses/16"
    echo ""
    echo "This will DELETE all .m3u8 and .ts files (HLS content) from the specified path."
    echo "Add --confirm flag to actually delete, otherwise it will only preview."
    exit 1
fi

BUCKET="$1"
PREFIX="$2"
CONFIRM_DELETE="$3"

# Remove trailing slash from prefix
PREFIX=$(echo "$PREFIX" | sed 's|/$||')

log_info "🔍 Searching for HLS files (.m3u8 and .ts) to delete"
echo "🪣 Bucket: $BUCKET"
echo "📂 Prefix: $PREFIX"
echo ""

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    log_error "AWS credentials not configured"
    exit 1
fi

# Create temp files for results
TEMP_M3U8="/tmp/m3u8_files_$(date +%s).txt"
TEMP_TS="/tmp/ts_files_$(date +%s).txt"
TEMP_ALL="/tmp/all_hls_files_$(date +%s).txt"

# Find all .m3u8 files
log_info "Scanning for .m3u8 playlist files..."
aws s3 ls "s3://$BUCKET/$PREFIX/" --recursive | grep "\.m3u8$" | awk '{print $4}' > "$TEMP_M3U8"

# Find all .ts files
log_info "Scanning for .ts segment files..."
aws s3 ls "s3://$BUCKET/$PREFIX/" --recursive | grep "\.ts$" | awk '{print $4}' > "$TEMP_TS"

# Combine both lists
cat "$TEMP_M3U8" "$TEMP_TS" > "$TEMP_ALL"

# Check if any files found
if [ ! -s "$TEMP_ALL" ]; then
    log_warning "No HLS files (.m3u8 or .ts) found in s3://$BUCKET/$PREFIX/"
    rm -f "$TEMP_M3U8" "$TEMP_TS" "$TEMP_ALL"
    exit 0
fi

M3U8_COUNT=$(wc -l < "$TEMP_M3U8" | tr -d ' ')
TS_COUNT=$(wc -l < "$TEMP_TS" | tr -d ' ')
TOTAL_COUNT=$(wc -l < "$TEMP_ALL" | tr -d ' ')

log_success "Found $M3U8_COUNT .m3u8 playlist files"
log_success "Found $TS_COUNT .ts segment files"
log_success "Total: $TOTAL_COUNT HLS files to delete"

echo ""
echo "📋 Sample files to be deleted:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📄 .m3u8 playlists (showing first 10):"
head -10 "$TEMP_M3U8" | while read file; do
    echo "    🗑️  $file"
done
if [ $M3U8_COUNT -gt 10 ]; then
    echo "    ... and $((M3U8_COUNT - 10)) more .m3u8 files"
fi

echo ""
echo "  📹 .ts segments (showing first 10):"
head -10 "$TEMP_TS" | while read file; do
    echo "    🗑️  $file"
done
if [ $TS_COUNT -gt 10 ]; then
    echo "    ... and $((TS_COUNT - 10)) more .ts files"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
log_warning "This will delete $TOTAL_COUNT HLS files ($M3U8_COUNT playlists + $TS_COUNT segments)"
echo ""

# Check if confirm flag is provided
if [ "$CONFIRM_DELETE" != "--confirm" ]; then
    log_info "🔍 PREVIEW MODE - No files will be deleted"
    echo ""
    echo "To actually delete these files, run:"
    echo "  $0 $BUCKET $PREFIX --confirm"
    echo ""
    log_warning "⚠️  This will permanently delete ALL HLS content (playlists + segments)!"
    log_warning "⚠️  Original MP4 files will remain intact"
    rm -f "$TEMP_M3U8" "$TEMP_TS" "$TEMP_ALL"
    exit 0
fi

# Confirm deletion
echo ""
log_warning "⚠️  WARNING: This will PERMANENTLY DELETE $TOTAL_COUNT HLS files!"
log_warning "⚠️  Including $M3U8_COUNT playlists and $TS_COUNT video segments!"
echo ""
read -p "Are you absolutely sure? Type 'DELETE' to confirm: " CONFIRMATION

if [ "$CONFIRMATION" != "DELETE" ]; then
    log_info "Deletion cancelled"
    rm -f "$TEMP_M3U8" "$TEMP_TS" "$TEMP_ALL"
    exit 0
fi

# Proceed with deletion
log_info "🗑️  Starting deletion..."
echo ""

DELETED_COUNT=0
FAILED_COUNT=0

while read file; do
    if aws s3 rm "s3://$BUCKET/$file" &> /dev/null; then
        EXTENSION="${file##*.}"
        echo "✅ Deleted .$EXTENSION: $(basename "$file")"
        ((DELETED_COUNT++))
    else
        echo "❌ Failed: $file"
        ((FAILED_COUNT++))
    fi
done < "$TEMP_ALL"

echo ""
log_success "Deletion complete!"
echo "  ✅ Deleted: $DELETED_COUNT files"
if [ $FAILED_COUNT -gt 0 ]; then
    log_error "  ❌ Failed: $FAILED_COUNT files"
fi

# Cleanup
rm -f "$TEMP_M3U8" "$TEMP_TS" "$TEMP_ALL"

echo ""
log_info "Note: Original MP4 files remain intact"