"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/handler.ts
var handler_exports = {};
__export(handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(handler_exports);
var import_node_path = __toESM(require("node:path"));
var import_client_mediaconvert = require("@aws-sdk/client-mediaconvert");
var ROLE_ARN = process.env.MEDIACONVERT_ROLE_ARN;
var OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || "";
var handler = async (event) => {
  console.log(JSON.stringify(event, null, 2));
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const results = [];
  for (const rec of event.Records || []) {
    try {
      const inputBucket = rec.s3.bucket.name;
      const rawKey = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
      if (!rawKey.toLowerCase().endsWith(".mp4")) continue;
      const base = import_node_path.default.basename(rawKey, ".mp4");
      const dir = rawKey.includes("/") ? rawKey.substring(0, rawKey.lastIndexOf("/") + 1) : "";
      const destinationBucket = OUTPUT_BUCKET || inputBucket;
      const inputUri = `s3://${inputBucket}/${rawKey}`;
      const destS3 = `s3://${destinationBucket}/${dir}`;
      const discover = new import_client_mediaconvert.MediaConvertClient({ region });
      const ep = await discover.send(
        new import_client_mediaconvert.DescribeEndpointsCommand({ MaxResults: 1 })
      );
      const endpoint = ep.Endpoints?.[0]?.Url || `https://mediaconvert.${region}.amazonaws.com`;
      const mc = new import_client_mediaconvert.MediaConvertClient({ region, endpoint });
      const params = {
        Role: ROLE_ARN,
        Settings: buildHlsSettings(inputUri, destS3),
        UserMetadata: {
          OriginalKey: rawKey,
          OriginalFileName: `${base}.mp4`,
          Ladder: "144p,240p,360p,480p,720p,1080p"
        }
      };
      const res = await mc.send(new import_client_mediaconvert.CreateJobCommand(params));
      const jobId = res.Job?.Id;
      const manifestGuess = `https://${destinationBucket}.s3.${region}.amazonaws.com/${dir}master.m3u8`;
      results.push({ key: rawKey, jobId, manifestGuess });
      console.log(`Created MediaConvert job ${jobId} for ${rawKey}`);
    } catch (err) {
      console.error("CreateJob failed:", err?.message || err);
      results.push({
        key: rec.s3.object.key,
        error: String(err?.message || err)
      });
    }
  }
  return { ok: true, results };
};
function buildHlsSettings(inputUri, destS3) {
  return {
    Inputs: [
      {
        FileInput: inputUri,
        TimecodeSource: "ZEROBASED",
        AudioSelectors: {
          "Audio Selector 1": { DefaultSelection: "DEFAULT" }
        }
      }
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
            ClientCache: "ENABLED",
            CodecSpecification: "RFC_4281",
            StreamInfResolution: "INCLUDE"
          }
        },
        Outputs: [
          // width x height, maxBitrate (bps), audio bitrate (bps)
          makeOutput("_144p", 256, 144, 25e4, 64e3),
          makeOutput("_240p", 426, 240, 4e5, 96e3),
          makeOutput("_360p", 640, 360, 8e5, 96e3),
          makeOutput("_480p", 854, 480, 14e5, 128e3),
          makeOutput("_720p", 1280, 720, 35e5, 128e3),
          makeOutput("_1080p", 1920, 1080, 65e5, 192e3)
        ]
      }
    ]
  };
}
function makeOutput(suffix, width, height, maxBitrate, audioBitrate) {
  return {
    NameModifier: suffix,
    ContainerSettings: {
      Container: "M3U8",
      M3u8Settings: {
        AudioFramesPerPes: 4,
        PcrControl: "PCR_EVERY_PES_PACKET",
        ProgramNumber: 1
      }
    },
    VideoDescription: {
      Width: width,
      Height: height,
      ScalingBehavior: "DEFAULT",
      TimecodeInsertion: "DISABLED",
      AntiAlias: "ENABLED",
      Sharpness: 50,
      AfdSignaling: "NONE",
      DropFrameTimecode: "ENABLED",
      RespondToAfd: "NONE",
      ColorMetadata: "INSERT",
      CodecSettings: {
        Codec: "H_264",
        H264Settings: {
          RateControlMode: "QVBR",
          QvbrSettings: { QvbrQualityLevel: 8 },
          QualityTuningLevel: "SINGLE_PASS",
          MaxBitrate: maxBitrate,
          FramerateControl: "INITIALIZE_FROM_SOURCE",
          GopSize: 2,
          GopSizeUnits: "SECONDS",
          NumberBFramesBetweenReferenceFrames: 2,
          GopClosedCadence: 1,
          CodecLevel: "AUTO",
          CodecProfile: "MAIN",
          AdaptiveQuantization: "HIGH",
          EntropyEncoding: "CABAC",
          ParControl: "INITIALIZE_FROM_SOURCE",
          SceneChangeDetect: "TRANSITION_DETECTION",
          SpatialAdaptiveQuantization: "ENABLED",
          TemporalAdaptiveQuantization: "ENABLED",
          UnregisteredSeiTimecode: "DISABLED",
          SlowPal: "DISABLED",
          Telecine: "NONE"
        }
      }
    },
    AudioDescriptions: [
      {
        AudioSourceName: "Audio Selector 1",
        LanguageCodeControl: "FOLLOW_INPUT",
        AudioTypeControl: "FOLLOW_INPUT",
        CodecSettings: {
          Codec: "AAC",
          AacSettings: {
            Bitrate: audioBitrate,
            CodingMode: "CODING_MODE_2_0",
            SampleRate: 48e3,
            Specification: "MPEG4"
          }
        }
      }
    ]
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
