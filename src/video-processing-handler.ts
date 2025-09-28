import { S3Event } from "aws-lambda";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createWriteStream, promises as fs } from "fs";
import { execSync } from "child_process";
import path from "path";
import { Readable } from "stream";

const FFMPEG_PATH =
  process.env.FFMPEG_PATH || path.join(process.cwd(), "ffmpeg");
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});

interface VideoProcessingResult {
  inputKey: string;
  outputFiles: string[];
  masterPlaylistUrl: string;
  error?: string;
  success: boolean;
  processingTimeMs: number;
  videoName: string;
  outputDirectory: string;
}

interface VideoQuality {
  name: string;
  width: number;
  height: number;
  videoBitrate: string;
  audioBitrate: string;
  bufferSize: string;
  crf: number;
}

// Lambda handler - Exact implementation of batch-convert-keep-structure.sh
export const handler = async (
  event: S3Event
): Promise<{ results: VideoProcessingResult[] }> => {
  console.log(
    "🎬 Converting MP4s to HLS - Keeping Original Structure (Lambda Version)"
  );
  console.log("📋 Event received:", JSON.stringify(event, null, 2));

  const processingResults: VideoProcessingResult[] = [];

  for (const s3Record of event.Records) {
    const startTime = Date.now();
    const sourceBucket = s3Record.s3.bucket.name;
    const sourceKey = decodeURIComponent(
      s3Record.s3.object.key.replace(/\+/g, " ")
    );

    console.log(`🪣 Bucket: ${sourceBucket}`);
    console.log(`📂 Processing: ${sourceKey}`);

    // Filter for .mp4 files only
    if (!sourceKey.toLowerCase().endsWith(".mp4")) {
      console.log(`⏭️ Skipping ${sourceKey} - not an MP4 file`);
      continue;
    }

    try {
      console.log(`🎬 [${path.basename(sourceKey, ".mp4")}] Converting...`);
      const result = await convertMp4ToHls(sourceBucket, sourceKey);
      result.processingTimeMs = Date.now() - startTime;
      processingResults.push(result);

      console.log(
        `✅ [${result.videoName}] Complete! ${result.masterPlaylistUrl}`
      );
    } catch (error) {
      const videoName = path.basename(sourceKey, ".mp4");
      console.error(`❌ [${videoName}] Processing failed:`, error);
      processingResults.push({
        inputKey: sourceKey,
        outputFiles: [],
        masterPlaylistUrl: "",
        videoName,
        outputDirectory: "",
        error: error instanceof Error ? error.message : String(error),
        success: false,
        processingTimeMs: Date.now() - startTime,
      });
    }
  }

  console.log("🎉 All conversions completed!");
  console.log(
    "📁 Structure maintained - HLS files are alongside original MP4s"
  );
  console.log("🔗 Each video now has a master playlist: VIDEO_NAME.m3u8");

  return { results: processingResults };
};

// Convert MP4 to HLS - Exact implementation of bash script convert_mp4_to_hls function
async function convertMp4ToHls(
  bucket: string,
  s3Key: string
): Promise<VideoProcessingResult> {
  const videoDir = path.dirname(s3Key);
  const videoName = path.basename(s3Key, ".mp4");
  const tempInput = `/tmp/${videoName}_${Date.now()}_${process.pid}.mp4`;
  const tempOutput = `/tmp/${videoName}_hls_${process.pid}`;

  try {
    // Download MP4 (same as bash script)
    console.log(`📥 [${videoName}] Downloading...`);
    await downloadMp4FromS3(bucket, s3Key, tempInput);

    // Create temp output directory
    await fs.mkdir(tempOutput, { recursive: true });

    // Validate FFmpeg
    await validateFFmpegBinary();

    // Generate 480p (exact bash script command)
    await generateQualityHLS(tempInput, tempOutput, videoName, {
      name: "480p",
      width: 854,
      height: 480,
      videoBitrate: "1000k",
      audioBitrate: "128k",
      bufferSize: "2000k",
      crf: 23,
    });

    // Generate 720p (exact bash script command)
    await generateQualityHLS(tempInput, tempOutput, videoName, {
      name: "720p",
      width: 1280,
      height: 720,
      videoBitrate: "2500k",
      audioBitrate: "128k",
      bufferSize: "5000k",
      crf: 21,
    });

    // Generate 1080p (exact bash script command)
    await generateQualityHLS(tempInput, tempOutput, videoName, {
      name: "1080p",
      width: 1920,
      height: 1080,
      videoBitrate: "5000k",
      audioBitrate: "192k",
      bufferSize: "10000k",
      crf: 20,
    });

    // Create master playlist (exact same as bash script)
    await createMasterPlaylist(tempOutput, videoName);

    // Upload HLS files to the SAME directory as the original MP4
    console.log(`📤 [${videoName}] Uploading HLS files...`);
    const uploadedFiles = await uploadHlsFiles(
      bucket,
      videoDir,
      tempOutput,
      videoName
    );

    // Cleanup (same as bash script)
    await cleanupFiles(tempInput, tempOutput);

    const masterPlaylistUrl = `https://${bucket}.s3.us-east-1.amazonaws.com/${videoDir}/${videoName}.m3u8`;

    return {
      inputKey: s3Key,
      outputFiles: uploadedFiles,
      masterPlaylistUrl,
      videoName,
      outputDirectory: videoDir,
      success: true,
      processingTimeMs: 0, // Set by caller
    };
  } catch (error) {
    // Cleanup on error
    await cleanupFiles(tempInput, tempOutput);
    throw error;
  }
}

// Download MP4 from S3 (same as bash: aws s3 cp)
async function downloadMp4FromS3(
  bucket: string,
  s3Key: string,
  localPath: string
): Promise<void> {
  const getObjectCommand = new GetObjectCommand({
    Bucket: bucket,
    Key: s3Key,
  });

  const s3Response = await s3Client.send(getObjectCommand);

  if (!s3Response.Body) {
    throw new Error(`❌ Download failed - empty response body`);
  }

  const fileWriteStream = createWriteStream(localPath);
  const s3ReadableStream = s3Response.Body as Readable;

  return new Promise((resolve, reject) => {
    s3ReadableStream.pipe(fileWriteStream);
    fileWriteStream.on("finish", resolve);
    fileWriteStream.on("error", reject);
    s3ReadableStream.on("error", reject);
  });
}

// Validate FFmpeg binary availability
async function validateFFmpegBinary(): Promise<void> {
  try {
    await fs.access(FFMPEG_PATH, fs.constants.F_OK | fs.constants.X_OK);
    console.log("✅ FFmpeg binary validated and executable");
  } catch (error) {
    throw new Error(
      `❌ FFmpeg binary not found or not executable at ${FFMPEG_PATH}`
    );
  }
}

// Generate HLS for single quality (exact bash script ffmpeg command)
async function generateQualityHLS(
  inputPath: string,
  outputDir: string,
  videoName: string,
  quality: VideoQuality
): Promise<void> {
  console.log(`🔄 Generating ${quality.name} HLS rendition...`);

  // Exact FFmpeg command from bash script
  const ffmpegCommand = [
    FFMPEG_PATH,
    "-i",
    `"${inputPath}"`,
    "-y",
    "-vf",
    `"scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2"`,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    quality.crf.toString(),
    "-maxrate",
    quality.videoBitrate,
    "-bufsize",
    quality.bufferSize,
    "-c:a",
    "aac",
    "-b:a",
    quality.audioBitrate,
    "-ac",
    "2",
    "-hls_time",
    "6",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    `"${outputDir}/${videoName}_${quality.name}_%03d.ts"`,
    `"${outputDir}/${videoName}_${quality.name}.m3u8"`,
    "-loglevel",
    "error",
  ].join(" ");

  try {
    execSync(ffmpegCommand, {
      stdio: ["ignore", "ignore", "ignore"], // Same as bash script 2>/dev/null
      maxBuffer: 1024 * 1024 * 50,
      timeout: 600000,
    });
    console.log(`✅ ${quality.name} rendition completed`);
  } catch (error: any) {
    console.error(`❌ Failed to generate ${quality.name} rendition:`, error);
    throw new Error(`FFmpeg processing failed for ${quality.name}`);
  }
}

// Create master playlist with same name as MP4 (exact bash script cat > EOF)
async function createMasterPlaylist(
  outputDir: string,
  videoName: string
): Promise<void> {
  // Exact same master playlist as bash script
  const masterPlaylistContent = `#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=1128000,RESOLUTION=854x480,CODECS="avc1.42e01e,mp4a.40.2"
${videoName}_480p.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720,CODECS="avc1.42e01e,mp4a.40.2"
${videoName}_720p.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=5192000,RESOLUTION=1920x1080,CODECS="avc1.42e01f,mp4a.40.2"
${videoName}_1080p.m3u8
`;

  const masterPlaylistPath = path.join(outputDir, `${videoName}.m3u8`);
  await fs.writeFile(masterPlaylistPath, masterPlaylistContent, "utf8");
  console.log(`📋 Created master playlist: ${videoName}.m3u8`);
}

// Upload HLS files - Exact same as bash script upload logic
async function uploadHlsFiles(
  bucket: string,
  videoDir: string,
  tempOutput: string,
  videoName: string
): Promise<string[]> {
  const uploadedFiles: string[] = [];

  const uploadFile = async (
    localPath: string,
    s3Key: string,
    contentType: string,
    cacheControl: string
  ) => {
    const fileContent = await fs.readFile(localPath);
    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: fileContent,
      ContentType: contentType,
      CacheControl: cacheControl,
    });

    await s3Client.send(putCommand);
    uploadedFiles.push(s3Key);
    console.log(`📤 Uploaded: ${s3Key}`);
  };

  // Upload master playlist (same as bash: aws s3 cp with content-type and cache-control)
  await uploadFile(
    path.join(tempOutput, `${videoName}.m3u8`),
    `${videoDir}/${videoName}.m3u8`,
    "application/vnd.apple.mpegurl",
    "no-cache"
  );

  // Upload quality playlists (same as bash script loop)
  const qualities = ["480p", "720p", "1080p"];
  for (const quality of qualities) {
    await uploadFile(
      path.join(tempOutput, `${videoName}_${quality}.m3u8`),
      `${videoDir}/${videoName}_${quality}.m3u8`,
      "application/vnd.apple.mpegurl",
      "no-cache"
    );
  }

  // Upload segments (same as bash: aws s3 cp --recursive --exclude "*.m3u8")
  const files = await fs.readdir(tempOutput);
  const segmentFiles = files.filter((file) => file.endsWith(".ts"));

  console.log(`📦 Uploading ${segmentFiles.length} video segments...`);
  for (const segmentFile of segmentFiles) {
    await uploadFile(
      path.join(tempOutput, segmentFile),
      `${videoDir}/${segmentFile}`,
      "video/mp2t",
      "max-age=31536000"
    );
  }

  return uploadedFiles;
}

// Cleanup files (same as bash script: rm -rf)
async function cleanupFiles(
  tempInput: string,
  tempOutput: string
): Promise<void> {
  try {
    // Remove temp input file
    await fs.unlink(tempInput).catch(() => {});
    // Remove temp output directory
    await fs.rm(tempOutput, { recursive: true, force: true }).catch(() => {});
    console.log("🧹 Cleanup completed");
  } catch (error) {
    console.warn("⚠️ Cleanup warning:", error);
  }
}
