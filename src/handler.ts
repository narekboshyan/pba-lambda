import type { S3Event } from "aws-lambda";
import path from "node:path";
import {
  MediaConvertClient,
  DescribeEndpointsCommand,
  CreateJobCommand,
  type CreateJobCommandInput,
} from "@aws-sdk/client-mediaconvert";

const ROLE_ARN = process.env.MEDIACONVERT_ROLE_ARN!;
const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || "";

// Optional: readability alias for the Output item type
type OutputItem = NonNullable<
  NonNullable<
    NonNullable<CreateJobCommandInput["Settings"]>["OutputGroups"]
  >[number]["Outputs"]
>[number];

export const handler = async (event: S3Event) => {
  console.log(JSON.stringify(event, null, 2));
  const region =
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const results: Array<{
    key: string;
    jobId?: string;
    manifestGuess?: string;
    error?: string;
  }> = [];

  for (const rec of event.Records || []) {
    try {
      const inputBucket = rec.s3.bucket.name;
      const rawKey = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
      if (!rawKey.toLowerCase().endsWith(".mp4")) continue;

      const base = path.basename(rawKey, ".mp4");
      const dir = rawKey.includes("/")
        ? rawKey.substring(0, rawKey.lastIndexOf("/") + 1)
        : "";
      const destinationBucket = OUTPUT_BUCKET || inputBucket;

      const inputUri = `s3://${inputBucket}/${rawKey}`;
      const destS3 = `s3://${destinationBucket}/${dir}`;

      // Discover MediaConvert endpoint
      const discover = new MediaConvertClient({ region });
      const ep = await discover.send(
        new DescribeEndpointsCommand({ MaxResults: 1 })
      );
      const endpoint =
        ep.Endpoints?.[0]?.Url ||
        `https://mediaconvert.${region}.amazonaws.com`;

      // Submit job with 3 quality levels matching bash script
      const mc = new MediaConvertClient({ region, endpoint });
      const params: CreateJobCommandInput = {
        Role: ROLE_ARN,
        Settings: buildHlsSettings(inputUri, destS3),
        UserMetadata: {
          OriginalKey: rawKey,
          OriginalFileName: `${base}.mp4`,
          Ladder: "480p,720p,1080p-HQ",
        },
      };
      const res = await mc.send(new CreateJobCommand(params));
      const jobId = res.Job?.Id;

      const manifestGuess = `https://${destinationBucket}.s3.${region}.amazonaws.com/${dir}${base}.m3u8`;
      results.push({ key: rawKey, jobId, manifestGuess });
      console.log(`Created MediaConvert job ${jobId} for ${rawKey}`);
    } catch (err: any) {
      console.error("CreateJob failed:", err?.message || err);
      results.push({
        key: rec.s3.object.key,
        error: String(err?.message || err),
      });
    }
  }

  return { ok: true, results };
};

function buildHlsSettings(
  inputUri: string,
  destS3: string
): CreateJobCommandInput["Settings"] {
  return {
    Inputs: [
      {
        FileInput: inputUri,
        TimecodeSource: "ZEROBASED",
        AudioSelectors: {
          "Audio Selector 1": { DefaultSelection: "DEFAULT" as const },
        },
      },
    ],
    OutputGroups: [
      {
        Name: "Apple HLS",
        OutputGroupSettings: {
          Type: "HLS_GROUP_SETTINGS",
          HlsGroupSettings: {
            Destination: destS3,
            SegmentLength: 6,
            MinSegmentLength: 0,
            DirectoryStructure: "SINGLE_DIRECTORY",
            ManifestCompression: "NONE",
            ManifestDurationFormat: "INTEGER",
            ClientCache: "ENABLED" as const,
            CodecSpecification: "RFC_4281" as const,
            StreamInfResolution: "INCLUDE" as const,
          },
        },
        Outputs: [
          // Match the bash script: 480p, 720p, 1080p-HQ
          makeOutput("_480p", 854, 480, 1_400_000, 128_000),
          makeOutput("_720p", 1280, 720, 3_500_000, 128_000),
          makeOutput("_1080p", 1920, 1080, 10_000_000, 256_000, true), // HQ version
        ],
      },
    ],
  } satisfies NonNullable<CreateJobCommandInput["Settings"]>;
}

function makeOutput(
  suffix: string,
  width: number,
  height: number,
  maxBitrate: number,
  audioBitrate: number,
  isHQ: boolean = false // For 1080p high quality settings
) {
  return {
    NameModifier: suffix,
    ContainerSettings: {
      Container: "M3U8" as const,
      M3u8Settings: {
        AudioFramesPerPes: 4,
        PcrControl: "PCR_EVERY_PES_PACKET" as const,
        ProgramNumber: 1,
      },
    },
    VideoDescription: {
      Width: width,
      Height: height,
      ScalingBehavior: "DEFAULT" as const,
      TimecodeInsertion: "DISABLED" as const,
      AntiAlias: "ENABLED" as const,
      Sharpness: 50,
      AfdSignaling: "NONE" as const,
      DropFrameTimecode: "ENABLED" as const,
      RespondToAfd: "NONE" as const,
      ColorMetadata: "INSERT" as const,
      CodecSettings: {
        Codec: "H_264" as const,
        H264Settings: {
          RateControlMode: "QVBR" as const,
          QvbrSettings: { QvbrQualityLevel: isHQ ? 9 : 8 }, // Higher quality for 1080p
          QualityTuningLevel: isHQ ? "MULTI_PASS_HQ" : ("SINGLE_PASS" as const),
          MaxBitrate: maxBitrate,
          FramerateControl: "INITIALIZE_FROM_SOURCE" as const,
          GopSize: 2.0,
          GopSizeUnits: "SECONDS" as const,
          NumberBFramesBetweenReferenceFrames: isHQ ? 3 : 2, // More B-frames for HQ
          GopClosedCadence: 1,
          CodecLevel: "AUTO" as const,
          CodecProfile: isHQ ? "HIGH" : ("MAIN" as const), // HIGH profile for 1080p
          AdaptiveQuantization: "HIGH" as const,
          EntropyEncoding: "CABAC" as const,
          ParControl: "INITIALIZE_FROM_SOURCE" as const,
          SceneChangeDetect: "TRANSITION_DETECTION" as const,
          SpatialAdaptiveQuantization: "ENABLED" as const,
          TemporalAdaptiveQuantization: "ENABLED" as const,
          UnregisteredSeiTimecode: "DISABLED" as const,
          SlowPal: "DISABLED" as const,
          Telecine: "NONE" as const,
        },
      },
    },
    AudioDescriptions: [
      {
        AudioSourceName: "Audio Selector 1",
        LanguageCodeControl: "FOLLOW_INPUT" as const,
        AudioTypeControl: "FOLLOW_INPUT" as const,
        CodecSettings: {
          Codec: "AAC" as const,
          AacSettings: {
            Bitrate: audioBitrate,
            CodingMode: "CODING_MODE_2_0" as const,
            SampleRate: 48000,
            Specification: "MPEG4" as const,
          },
        },
      },
    ],
  } satisfies OutputItem;
}
