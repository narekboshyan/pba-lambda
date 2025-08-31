import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { Mp4ToHlsStack } from "../lib/mp4-to-hls-stack";

const app = new cdk.App();

const environment = app.node.tryGetContext("environment") || "production";
const inputBucket = app.node.tryGetContext("inputBucket") || "pba-users-bucket";
const outputBucket =
  app.node.tryGetContext("outputBucket") || "pba-users-bucket";
const prefix = app.node.tryGetContext("prefix") || "OnlineCourses/";

// Stack naming convention
const stackName =
  environment === "production"
    ? "Mp4ToHlsStack"
    : `Mp4ToHlsStack-${environment}`;

new Mp4ToHlsStack(app, stackName, {
  inputBucketName: inputBucket,
  outputBucketName: outputBucket,
  prefix: prefix,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  tags: {
    Environment: environment,
    Project: "pba-lambda",
    ManagedBy: "CDK",
  },
});

app.synth();
