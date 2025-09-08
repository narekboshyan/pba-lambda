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

const s3Client = new S3Client({});

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

export const handler = async (
  event: S3Event
): Promise<{ results: VideoProcessingResult[] }> => {
  console.log(
    "Video processing event received:",
    JSON.stringify(event, null, 2)
  );
  const processingResults: VideoProcessingResult[] = [];

  for (const s3Record of event.Records) {
    const startTime = Date.now();
    const sourceBucket = s3Record.s3.bucket.name;
    const sourceKey = decodeURIComponent(
      s3Record.s3.object.key.replace(/\+/g, " ")
    );

    // Filter for .mp4 files only
    if (!sourceKey.toLowerCase().endsWith(".mp4")) {
      console.log(`Skipping ${sourceKey} - not an MP4 file`);
      continue;
    }

    try {
      console.log(`🎬 Starting video processing for: ${sourceKey}`);
      const result = await processVideoToHLS(sourceBucket, sourceKey);
      result.processingTimeMs = Date.now() - startTime;
      processingResults.push(result);
      console.log(
        `✅ Completed processing ${sourceKey} in ${result.processingTimeMs}ms`
      );
    } catch (error) {
      console.error(`❌ Error processing ${sourceKey}:`, error);
      processingResults.push({
        inputKey: sourceKey,
        outputFiles: [],
        masterPlaylistUrl: "",
        videoName: path.basename(sourceKey, ".mp4"),
        outputDirectory: "",
        error: error instanceof Error ? error.message : String(error),
        success: false,
        processingTimeMs: Date.now() - startTime,
      });
    }
  }

  return { results: processingResults };
};

async function processVideoToHLS(
  bucketName: string,
  videoKey: string
): Promise<VideoProcessingResult> {
  const videoName = path.basename(videoKey, ".mp4");
  const videoDirectory = path.dirname(videoKey);
  const tempInputPath = `/tmp/${videoName}_${Date.now()}.mp4`;
  const tempOutputDirectory = `/tmp/hls_output_${Date.now()}`;

  try {
    // Create temporary directory structure
    await createTemporaryDirectories(tempOutputDirectory);

    // Download source video from S3
    console.log(`📥 Downloading video: ${videoKey}`);
    await downloadVideoFromS3(bucketName, videoKey, tempInputPath);

    // Validate FFmpeg availability
    await validateFFmpegBinary();

    // Generate HLS renditions for multiple qualities
    console.log("🔄 Generating HLS renditions...");
    await generateMultiQualityHLS(
      tempInputPath,
      tempOutputDirectory,
      videoName
    );

    // Upload all generated HLS files to S3
    console.log("📤 Uploading HLS files to S3...");
    const uploadedFilesList = await uploadHLSFilesToS3(
      bucketName,
      videoDirectory,
      tempOutputDirectory,
      videoName
    );

    // Generate public URL for master playlist
    const masterPlaylistUrl = constructMasterPlaylistUrl(
      bucketName,
      videoDirectory,
      videoName
    );

    // Clean up temporary files
    await cleanupTemporaryFiles(tempInputPath, tempOutputDirectory);

    return {
      inputKey: videoKey,
      outputFiles: uploadedFilesList,
      masterPlaylistUrl,
      videoName,
      outputDirectory: `${videoDirectory}/${videoName}`,
      success: true,
      processingTimeMs: 0, // Will be set by caller
    };
  } catch (error) {
    // Clean up on error
    await cleanupTemporaryFiles(tempInputPath, tempOutputDirectory);
    throw error;
  }
}

async function createTemporaryDirectories(
  baseOutputDir: string
): Promise<void> {
  const qualityDirectories = ["480p", "720p", "1080p"];

  await fs.mkdir(baseOutputDir, { recursive: true });

  for (const quality of qualityDirectories) {
    await fs.mkdir(path.join(baseOutputDir, quality), { recursive: true });
  }

  console.log("📁 Created temporary directories");
}

async function downloadVideoFromS3(
  bucketName: string,
  videoKey: string,
  localPath: string
): Promise<void> {
  const getObjectCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: videoKey,
  });

  const s3Response = await s3Client.send(getObjectCommand);

  if (!s3Response.Body) {
    throw new Error("Empty response body from S3");
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

async function validateFFmpegBinary(): Promise<void> {
  try {
    await fs.access(FFMPEG_PATH, fs.constants.F_OK | fs.constants.X_OK);
    console.log("✅ FFmpeg binary validated and executable");
  } catch (error) {
    throw new Error(
      `FFmpeg binary not found or not executable at ${FFMPEG_PATH}`
    );
  }
}

async function generateMultiQualityHLS(
  inputVideoPath: string,
  outputBaseDir: string,
  videoName: string
): Promise<void> {
  const videoQualities: VideoQuality[] = [
    {
      name: "480p",
      width: 854,
      height: 480,
      videoBitrate: "1000k",
      audioBitrate: "128k",
      bufferSize: "2000k",
      crf: 23,
    },
    {
      name: "720p",
      width: 1280,
      height: 720,
      videoBitrate: "2500k",
      audioBitrate: "128k",
      bufferSize: "5000k",
      crf: 21,
    },
    {
      name: "1080p",
      width: 1920,
      height: 1080,
      videoBitrate: "5000k",
      audioBitrate: "192k",
      bufferSize: "10000k",
      crf: 20,
    },
  ];

  // Generate each quality rendition
  for (const quality of videoQualities) {
    await generateSingleQualityHLS(inputVideoPath, outputBaseDir, quality);
  }

  // Create adaptive streaming master playlist
  await createAdaptiveMasterPlaylist(outputBaseDir, videoName);
}

async function generateSingleQualityHLS(
  inputPath: string,
  outputBaseDir: string,
  quality: VideoQuality
): Promise<void> {
  const qualityOutputDir = path.join(outputBaseDir, quality.name);

  console.log(`🔄 Generating ${quality.name} HLS rendition...`);

  const ffmpegCommand = `${FFMPEG_PATH} -i "${inputPath}" -y \
    -vf "scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2" \
    -c:v libx264 -preset medium -crf ${quality.crf} \
    -maxrate ${quality.videoBitrate} -bufsize ${quality.bufferSize} \
    -c:a aac -b:a ${quality.audioBitrate} -ac 2 \
    -hls_time 6 \
    -hls_playlist_type vod \
    -hls_segment_filename "${qualityOutputDir}/segment_%03d.ts" \
    "${qualityOutputDir}/${quality.name}.m3u8"`;

  try {
    execSync(ffmpegCommand.replace(/\s+/g, " ").trim(), {
      stdio: "pipe",
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      timeout: 600000, // 10 minutes timeout per quality
    });
    console.log(`✅ ${quality.name} HLS rendition completed successfully`);
  } catch (error) {
    console.error(`❌ Failed to generate ${quality.name} rendition:`, error);
    throw new Error(`FFmpeg processing failed for ${quality.name}: ${error}`);
  }
}

async function createAdaptiveMasterPlaylist(
  outputBaseDir: string,
  videoName: string
): Promise<void> {
  const adaptiveMasterPlaylist = `#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=1128000,RESOLUTION=854x480,CODECS="avc1.42e01e,mp4a.40.2"
480p/480p.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720,CODECS="avc1.42e01e,mp4a.40.2"
720p/720p.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=5192000,RESOLUTION=1920x1080,CODECS="avc1.42e01f,mp4a.40.2"
1080p/1080p.m3u8
`;

  const masterPlaylistPath = path.join(outputBaseDir, "index.m3u8");
  await fs.writeFile(masterPlaylistPath, adaptiveMasterPlaylist, "utf8");
  console.log(`📋 Created adaptive master playlist: ${masterPlaylistPath}`);
}

async function uploadHLSFilesToS3(
  bucketName: string,
  originalVideoDir: string,
  localOutputDir: string,
  videoName: string
): Promise<string[]> {
  const uploadedFileKeys: string[] = [];

  // Upload single file to S3
  const uploadSingleFile = async (
    localFilePath: string,
    s3ObjectKey: string
  ): Promise<void> => {
    const fileContent = await fs.readFile(localFilePath);
    const contentType = determineContentType(localFilePath);

    const putObjectCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: s3ObjectKey,
      Body: fileContent,
      ContentType: contentType,
      CacheControl: contentType.includes("m3u8")
        ? "no-cache, no-store, must-revalidate"
        : "max-age=31536000",
      Metadata: {
        "original-video": videoName,
        "generated-timestamp": new Date().toISOString(),
        processor: "ffmpeg-lambda",
        format: "hls",
      },
    });

    await s3Client.send(putObjectCommand);
    uploadedFileKeys.push(s3ObjectKey);
    console.log(`📤 Uploaded: ${s3ObjectKey}`);
  };

  // Upload master playlist
  const masterPlaylistLocalPath = path.join(localOutputDir, "index.m3u8");
  const masterPlaylistS3Key = `${originalVideoDir}/${videoName}/index.m3u8`;
  await uploadSingleFile(masterPlaylistLocalPath, masterPlaylistS3Key);

  // Upload all quality renditions
  const supportedQualities = ["480p", "720p", "1080p"];

  for (const qualityLevel of supportedQualities) {
    const qualityLocalDir = path.join(localOutputDir, qualityLevel);
    const qualityFiles = await fs.readdir(qualityLocalDir);

    for (const qualityFile of qualityFiles) {
      const localFilePath = path.join(qualityLocalDir, qualityFile);
      const s3ObjectKey = `${originalVideoDir}/${videoName}/${qualityLevel}/${qualityFile}`;
      await uploadSingleFile(localFilePath, s3ObjectKey);
    }
  }

  return uploadedFileKeys;
}

function constructMasterPlaylistUrl(
  bucketName: string,
  videoDirectory: string,
  videoName: string
): string {
  return `https://${bucketName}.s3.amazonaws.com/${videoDirectory}/${videoName}/index.m3u8`;
}

function determineContentType(filePath: string): string {
  const fileExtension = path.extname(filePath).toLowerCase();
  switch (fileExtension) {
    case ".m3u8":
      return "application/vnd.apple.mpegurl";
    case ".ts":
      return "video/mp2t";
    default:
      return "application/octet-stream";
  }
}

async function cleanupTemporaryFiles(
  inputVideoPath: string,
  outputDirectory: string
): Promise<void> {
  try {
    // Remove downloaded input video
    await fs.unlink(inputVideoPath).catch(() => {}); // Ignore errors

    // Remove entire output directory tree
    await fs
      .rm(outputDirectory, { recursive: true, force: true })
      .catch(() => {}); // Ignore errors

    console.log("🧹 Cleaned up all temporary files");
  } catch (error) {
    console.warn("⚠️ Warning: Could not clean up some temporary files:", error);
  }
}
