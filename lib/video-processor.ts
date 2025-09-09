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

export interface VideoProcessingStackProps extends StackProps {
  bucketName: string;
  bucketPrefix?: string; // Optional prefix filter (e.g., "videos/", "uploads/")
  videoQualitiesCount?: number; // For naming/description purposes
  enableMonitoring?: boolean;
}

export class VideoProcessingStack extends Stack {
  public readonly videoProcessorFunction: lambdaNode.NodejsFunction;
  public readonly processingBucket: s3.IBucket;

  constructor(scope: Construct, id: string, props: VideoProcessingStackProps) {
    super(scope, id, props);

    // Import existing S3 bucket by name
    this.processingBucket = s3.Bucket.fromBucketName(
      this,
      "VideoProcessingBucket",
      props.bucketName
    );

    // Video processing Lambda function
    this.videoProcessorFunction = new lambdaNode.NodejsFunction(
      this,
      "VideoToHLSProcessorFunction",
      {
        entry: path.join(__dirname, "../src/video-processing-handler.ts"),
        runtime: lambda.Runtime.NODEJS_20_X,
        memorySize: 3008, // Maximum memory for better performance
        timeout: Duration.minutes(15), // Maximum timeout for Lambda
        architecture: lambda.Architecture.X86_64,
        // No layers - using bundled FFmpeg binary instead
        environment: {
          NODE_OPTIONS: "--max-old-space-size=2048",
          FFMPEG_PATH: "./ffmpeg", // Path to bundled binary
          VIDEO_PROCESSING_BUCKET: props.bucketName,
          LOG_LEVEL: "INFO",
        },
        logGroup: new logs.LogGroup(this, "VideoProcessorLogGroup", {
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        bundling: {
          target: "node20",
          format: lambdaNode.OutputFormat.CJS,
          nodeModules: ["@aws-sdk/client-s3"],
          commandHooks: {
            beforeBundling: () => [],
            beforeInstall: () => [],
            afterBundling: (inputDir: string, outputDir: string) => [
              // Download FFmpeg static binary as fallback
              `curl -L https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-linux-x64 -o ${outputDir}/ffmpeg`,
              `chmod +x ${outputDir}/ffmpeg`,
            ],
          },
        },
      }
    );

    // Grant comprehensive S3 permissions to the Lambda function
    this.grantS3Permissions();

    // Set up S3 event notification trigger
    this.setupS3EventTrigger(props.bucketPrefix);

    // Optionally create monitoring dashboard
    if (props.enableMonitoring) {
      this.createMonitoringDashboard();
    }

    // Create stack outputs
    this.createStackOutputs(props);
  }

  private grantS3Permissions(): void {
    // Grant read/write permissions for video files
    this.videoProcessorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:DeleteObject",
        ],
        resources: [this.processingBucket.arnForObjects("*")],
      })
    );

    // Grant bucket-level permissions
    this.videoProcessorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:ListBucket",
          "s3:GetBucketLocation",
          "s3:GetBucketVersioning",
        ],
        resources: [this.processingBucket.bucketArn],
      })
    );

    // Grant CloudWatch permissions for enhanced monitoring
    this.videoProcessorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "cloudwatch:PutMetricData",
        ],
        resources: ["*"],
      })
    );
  }

  private setupS3EventTrigger(bucketPrefix?: string): void {
    const eventNotificationFilters: any = {
      suffix: ".mp4",
    };

    // Add prefix filter if specified
    if (bucketPrefix) {
      eventNotificationFilters.prefix = bucketPrefix;
    }

    // Configure S3 to trigger Lambda on MP4 uploads
    this.processingBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.videoProcessorFunction),
      eventNotificationFilters
    );
  }

  private createMonitoringDashboard(): void {
    const monitoringDashboard = new cloudwatch.Dashboard(
      this,
      "VideoProcessingMonitoringDashboard",
      {
        dashboardName: `${this.stackName}-Video-Processing-Monitor`,
        widgets: [
          [
            new cloudwatch.GraphWidget({
              title: "Lambda Function Invocations",
              left: [this.videoProcessorFunction.metricInvocations()],
              width: 12,
            }),
            new cloudwatch.GraphWidget({
              title: "Lambda Function Errors",
              left: [this.videoProcessorFunction.metricErrors()],
              width: 12,
            }),
          ],
          [
            new cloudwatch.GraphWidget({
              title: "Processing Duration",
              left: [this.videoProcessorFunction.metricDuration()],
              width: 12,
            }),
            new cloudwatch.GraphWidget({
              title: "Function Throttles",
              left: [this.videoProcessorFunction.metricThrottles()],
              width: 12,
            }),
          ],
        ],
      }
    );

    // Create CloudWatch alarms for critical metrics
    new cloudwatch.Alarm(this, "VideoProcessingErrorAlarm", {
      metric: this.videoProcessorFunction.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: "Video processing function encountered an error",
    });

    new cloudwatch.Alarm(this, "VideoProcessingDurationAlarm", {
      metric: this.videoProcessorFunction.metricDuration(),
      threshold: Duration.minutes(10).toMilliseconds(),
      evaluationPeriods: 2,
      alarmDescription: "Video processing taking longer than expected",
    });
  }

  private createStackOutputs(props: VideoProcessingStackProps): void {
    new cdk.CfnOutput(this, "VideoProcessorFunctionName", {
      value: this.videoProcessorFunction.functionName,
      description: "Name of the video processing Lambda function",
      exportName: `${this.stackName}-VideoProcessorFunctionName`,
    });

    new cdk.CfnOutput(this, "VideoProcessorFunctionArn", {
      value: this.videoProcessorFunction.functionArn,
      description: "ARN of the video processing Lambda function",
      exportName: `${this.stackName}-VideoProcessorFunctionArn`,
    });

    new cdk.CfnOutput(this, "ProcessingBucketName", {
      value: this.processingBucket.bucketName,
      description: "S3 bucket used for video processing",
      exportName: `${this.stackName}-ProcessingBucketName`,
    });

    new cdk.CfnOutput(this, "VideoUploadCommand", {
      value: `aws s3 cp your-video.mp4 s3://${
        this.processingBucket.bucketName
      }/${props.bucketPrefix || ""}your-video.mp4`,
      description: "Example AWS CLI command to upload a video for processing",
    });

    new cdk.CfnOutput(this, "ExpectedHLSOutputUrl", {
      value: `https://${this.processingBucket.bucketName}.s3.amazonaws.com/${
        props.bucketPrefix || ""
      }your-video.m3u8`,
      description:
        "Expected URL pattern for HLS master playlist after processing",
    });

    new cdk.CfnOutput(this, "SupportedVideoQualities", {
      value: "480p, 720p, 1080p",
      description: "Video quality levels generated during processing",
    });
  }
}
