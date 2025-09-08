import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { VideoProcessingStack } from "../lib/video-processor";

const app = new cdk.App();

// Your specific configuration
const environment = "production";
const bucketName = "pba-test-convert";
const bucketPrefix = "Level-8/";

// Create the stack
new VideoProcessingStack(app, "VideoProcessingStack", {
  bucketName: bucketName,
  bucketPrefix: bucketPrefix,
  enableMonitoring: true,
  // CDK will auto-detect account and region from AWS credentials
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  tags: {
    Environment: environment,
    Project: "pba-video-processing",
    ManagedBy: "CDK",
  },
});

app.synth();
