import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";

export interface Mp4ToHlsProps extends StackProps {
  inputBucketName: string;
  outputBucketName: string; // can be same as input
  prefix?: string; // optional object key prefix to filter on
}

export class Mp4ToHlsStack extends Stack {
  constructor(scope: Construct, id: string, props: Mp4ToHlsProps) {
    super(scope, id, props);

    // Import existing buckets by name (no new buckets created)
    const inputBucket = s3.Bucket.fromBucketName(
      this,
      "InputBucket",
      props.inputBucketName
    );
    const outputBucket = s3.Bucket.fromBucketName(
      this,
      "OutputBucket",
      props.outputBucketName
    );

    // MediaConvert service role (assumed by the service)
    const mediaConvertRole = new iam.Role(this, "MediaConvertRole", {
      assumedBy: new iam.ServicePrincipal("mediaconvert.amazonaws.com"),
      description:
        "Role used by AWS Elemental MediaConvert to read input and write outputs",
    });

    // Grants for MediaConvert
    mediaConvertRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [inputBucket.bucketArn, outputBucket.bucketArn],
      })
    );
    mediaConvertRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [inputBucket.arnForObjects("*")],
      })
    );
    mediaConvertRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [outputBucket.arnForObjects("*")],
      })
    );

    // Transcoder Lambda (Node 20, bundled by esbuild)
    const fn = new lambdaNode.NodejsFunction(this, "TranscoderFn", {
      entry: path.join(__dirname, "../src/handler.ts"),
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(60),
      architecture: lambda.Architecture.X86_64,
      environment: {
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
        OUTPUT_BUCKET: props.outputBucketName,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
      bundling: {
        target: "node20",
        format: lambdaNode.OutputFormat.CJS,
        // keep the SDK v3 in bundle (no "external")
      },
    });

    // Lambda IAM: MediaConvert API + PassRole + S3 access
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "mediaconvert:DescribeEndpoints",
          "mediaconvert:CreateJob",
          "mediaconvert:GetJob",
        ],
        resources: ["*"],
      })
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [mediaConvertRole.roleArn],
      })
    );
    // S3 read (input) + write (output) – Lambda sometimes needs to probe
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [inputBucket.bucketArn, outputBucket.bucketArn],
      })
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [inputBucket.arnForObjects("*")],
      })
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [outputBucket.arnForObjects("*")],
      })
    );

    // S3 → Lambda trigger for .mp4
    inputBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(fn),
      {
        suffix: ".mp4",
        prefix: props.prefix && props.prefix.length ? props.prefix : undefined,
      }
    );

    // CloudWatch Alarm on Lambda errors >= 1 over 5m
    new cloudwatch.Alarm(this, "TranscoderErrorsAlarm", {
      metric: fn.metricErrors({
        period: Duration.minutes(5),
        statistic: "sum",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "Lambda reported one or more errors in the last 5 minutes",
    });

    // Nice to see in Outputs
    new cdk.CfnOutput(this, "MediaConvertRoleArn", {
      value: mediaConvertRole.roleArn,
    });
    new cdk.CfnOutput(this, "LambdaName", { value: fn.functionName });
  }
}
