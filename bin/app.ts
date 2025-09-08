import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { VideoProcessingStack } from "../lib/video-processor";

const app = new cdk.App();

// Your specific configuration
const environment = "production";
const bucketName = "pba-test-mediaconvert";
const bucketPrefix = "Level-8/";

// Create the stack
new VideoProcessingStack(app, "VideoProcessingStack", {
  bucketName: bucketName,
  bucketPrefix: bucketPrefix,
  enableMonitoring: true,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  tags: {
    Environment: environment,
    Project: "pba-video-processing",
    ManagedBy: "CDK",
  },
});

app.synth();
