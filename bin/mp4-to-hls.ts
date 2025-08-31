#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { Mp4ToHlsStack } from "../lib/mp4-to-hls-stack";

const app = new cdk.App();

// Detect the CDK subcommand (deploy/synth/diff/bootstrap/...)
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const subcmd = args[0] ?? "";

// Only require context for commands that actually synth/deploy your stack
const requiresStack = ["deploy", "synth", "diff"].includes(subcmd);

// Context
const inputBucketName = app.node.tryGetContext("inputBucketName");
const outputBucketName =
  app.node.tryGetContext("outputBucketName") || inputBucketName;
const prefix = app.node.tryGetContext("prefix") || "";

// Allow passing account/region explicitly (or rely on env from the profile)
const account =
  app.node.tryGetContext("account") || process.env.CDK_DEFAULT_ACCOUNT;
const region =
  app.node.tryGetContext("region") ||
  process.env.CDK_DEFAULT_REGION ||
  process.env.AWS_REGION ||
  "us-east-1";

// If we're bootstrapping or other commands, don't fail on missing context
if (!requiresStack) {
  // No user stacks instantiated during bootstrap; CDK will create its own bootstrap stack.
  process.exit(0);
}

// Validate only when needed
if (!inputBucketName) {
  throw new Error("Missing -c inputBucketName=<name>");
}
if (!account) {
  throw new Error(
    "Missing account (pass -c account=<acct> or set AWS creds/profile)"
  );
}

new Mp4ToHlsStack(app, "Mp4ToHlsStack", {
  env: { account, region },
  inputBucketName,
  outputBucketName,
  prefix,
});
