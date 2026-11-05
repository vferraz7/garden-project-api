# Serverless Framework + AWS Implementation Guide

## Garden Project API - Complete Backend Migration

---

## 📋 Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [AWS Services Mapping](#2-aws-services-mapping)
3. [Serverless Framework Configuration](#3-serverless-framework-configuration)
4. [Database Strategy: MongoDB → DynamoDB](#4-database-strategy-mongodb--dynamodb)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [API Layer: API Gateway + Lambda](#6-api-layer-api-gateway--lambda)
7. [Observability: CloudWatch + X-Ray](#7-observability-cloudwatch--x-ray)
8. [CI/CD Pipeline](#8-cicd-pipeline)
9. [Local Development & Testing](#9-local-development--testing)
10. [Security Best Practices](#10-security-best-practices)
11. [Cost Optimization](#11-cost-optimization)
12. [Migration Strategy](#12-migration-strategy)
13. [Project Structure](#13-project-structure)
14. [Implementation Checklist](#14-implementation-checklist)

---

## 1. Architecture Overview

### 1.1 Current Architecture (Express + MongoDB)
```
Client → Express App (EC2/ECS) → MongoDB
              ↓
         In-memory: sessions, cache
```

### 1.2 Target Serverless Architecture
```
Client → CloudFront (CDN) → API Gateway (REST/HTTP)
                            ↓
                    Lambda Functions (Node.js 20.x)
                            ↓
              ┌─────────────┼─────────────┐
              ↓             ↓             ↓
         DynamoDB      DocumentDB      S3
         (Primary)     (Complex queries) (Assets)
              ↓
         ElastiCache (Redis) - Sessions, Cache
              ↓
         EventBridge - Async processing
              ↓
         SNS/SQS - Notifications, Webhooks
```

### 1.3 Key Benefits
| Aspect | Current | Serverless |
|--------|---------|------------|
| **Scaling** | Manual/ASG | Automatic (0 to ∞) |
| **Cost** | Fixed (idle) | Pay-per-request |
| **Operations** | High | Near-zero |
| **Cold Starts** | None | ~100-500ms (mitigated) |
| **Vendor Lock-in** | Low | Medium (AWS) |

---

## 2. AWS Services Mapping

### 2.1 Core Services

| Current Component | AWS Serverless Equivalent | Notes |
|-------------------|---------------------------|-------|
| Express App | **Lambda Functions** | One per route group or single mono-lambda |
| MongoDB | **DynamoDB** (primary) + **DocumentDB** (complex) | See Section 4 |
| Redis (sessions) | **ElastiCache Serverless Redis** | Or DynamoDB TTL |
| File Uploads | **S3** + CloudFront | Presigned URLs |
| Environment Config | **Parameter Store** / **Secrets Manager** | Secure, versioned |
| Logs | **CloudWatch Logs** | Structured JSON |
| Metrics | **CloudWatch Metrics** + **EMF** | Custom namespaces |
| Tracing | **X-Ray** | Automatic with SDK |
| Auth | **Cognito User Pools** | JWT, MFA, Social login |
| API Gateway | **HTTP API** (cheaper) or **REST API** | HTTP API recommended |
| Scheduled Jobs | **EventBridge Scheduler** | Cron expressions |

### 2.2 Supporting Services

| Purpose | Service | Configuration |
|---------|---------|---------------|
| Async Processing | **SQS** + **Lambda** | DLQ for failed messages |
| Event Bus | **EventBridge** | Domain events |
| Notifications | **SNS** | Email, Push, Webhook |
| Search | **OpenSearch Serverless** | Full-text search for logs |
| Analytics | **Athena** + **S3** | Query CloudWatch logs |
| CDN | **CloudFront** | Edge caching, WAF |

---

## 3. Serverless Framework Configuration

### 3.1 `serverless.yml` - Complete Configuration

```yaml
# serverless.yml
service: garden-api

frameworkVersion: '3'

provider:
  name: aws
  runtime: nodejs20.x
  architecture: arm64  # Graviton2 - 20% cheaper, 10% faster
  region: ${opt:region, 'us-east-1'}
  stage: ${opt:stage, 'dev'}

  # Environment variables
  environment:
    STAGE: ${self:provider.stage}
    REGION: ${self:provider.region}
    SERVICE_NAME: ${self:service}
    
    # Database
    DYNAMODB_TABLE: ${self:service}-${self:provider.stage}
    DOCUMENTDB_CLUSTER: ${ssm:/${self:service}/${self:provider.stage}/docdb/endpoint}
    
    # Auth
    COGNITO_USER_POOL_ID: ${ssm:/${self:service}/${self:provider.stage}/cognito/userPoolId}
    COGNITO_CLIENT_ID: ${ssm:/${self:service}/${self:provider.stage}/cognito/clientId}
    JWT_ACCESS_SECRET_ARN: ${ssm:/${self:service}/${self:provider.stage}/jwt/accessSecret}
    JWT_REFRESH_SECRET_ARN: ${ssm:/${self:service}/${self:provider.stage}/jwt/refreshSecret}
    
    # Redis
    REDIS_ENDPOINT: ${ssm:/${self:service}/${self:provider.stage}/redis/endpoint}
    
    # S3
    ASSETS_BUCKET: ${self:service}-assets-${self:provider.stage}
    
    # Feature flags
    ENABLE_XRAY: true
    LOG_LEVEL: ${self:custom.logLevel.${self:provider.stage}, 'info'}

  # IAM Role for Lambda
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - dynamodb:Query
            - dynamodb:Scan
            - dynamodb:GetItem
            - dynamodb:PutItem
            - dynamodb:UpdateItem
            - dynamodb:DeleteItem
            - dynamodb:BatchGetItem
            - dynamodb:BatchWriteItem
          Resource:
            - Fn::GetAtt: [MainTable, Arn]
            - Fn::GetAtt: [MainTable, Arn] /index/*
        
        - Effect: Allow
          Action:
            - rds-data:ExecuteStatement
            - rds-data:BatchExecuteStatement
            - rds-data:BeginTransaction
            - rds-data:CommitTransaction
            - rds-data:RollbackTransaction
          Resource: ${ssm:/${self:service}/${self:provider.stage}/docdb/clusterArn}
        
        - Effect: Allow
          Action:
            - s3:PutObject
            - s3:GetObject
            - s3:DeleteObject
          Resource: arn:aws:s3:::${self:provider.environment.ASSETS_BUCKET}/*
        
        - Effect: Allow
          Action:
            - secretsmanager:GetSecretValue
          Resource:
            - ${self:provider.environment.JWT_ACCESS_SECRET_ARN}
            - ${self:provider.environment.JWT_REFRESH_SECRET_ARN}
        
        - Effect: Allow
          Action:
            - elasticache:Connect
          Resource: ${self:provider.environment.REDIS_ENDPOINT}
        
        - Effect: Allow
          Action:
            - xray:PutTraceSegments
            - xray:PutTelemetryRecords
            - xray:GetSamplingRules
            - xray:GetSamplingTargets
          Resource: "*"
        
        - Effect: Allow
          Action:
            - logs:CreateLogGroup
            - logs:CreateLogStream
            - logs:PutLogEvents
          Resource: "*"

  # VPC Configuration (for DocumentDB, ElastiCache)
  vpc:
    securityGroupIds:
      - ${ssm:/${self:service}/${self:provider.stage}/vpc/securityGroupId}
    subnetIds:
      - ${ssm:/${self:service}/${self:provider.stage}/vpc/privateSubnet1}
      - ${ssm:/${self:service}/${self:provider.stage}/vpc/privateSubnet2}

  # Logs
  logRetentionInDays: 30

  # Tracing
  tracing:
    lambda: true
    apiGateway: true

  # Deployment
  deploymentBucket:
    name: ${self:service}-deployments-${self:provider.stage}
    serverSideEncryption: AES256

custom:
  logLevel:
    dev: debug
    staging: info
    prod: warn

  # DynamoDB Table
  dynamodb:
    tableName: ${self:service}-${self:provider.stage}
    billingMode: PAY_PER_REQUEST
    attributes:
      - name: PK
        type: S
      - name: SK
        type: S
      - name: GSI1PK
        type: S
      - name: GSI1SK
        type: S
      - name: GSI2PK
        type: S
      - name: GSI2SK
        type: S
    globalSecondaryIndexes:
      - indexName: GSI1
        keySchema:
          - AttributeName: GSI1PK
            KeyType: HASH
          - AttributeName: GSI1SK
            KeyType: RANGE
        projection:
          ProjectionType: ALL
      - indexName: GSI2
        keySchema:
          - AttributeName: GSI2PK
            KeyType: HASH
          - AttributeName: GSI2SK
            KeyType: RANGE
        projection:
          ProjectionType: ALL

  # API Gateway
  apiGateway:
    httpApi:
      cors: true
      defaultDomain: ${self:custom.domain.${self:provider.stage}}
      metrics: true
      logging: true

  domain:
    dev: dev.api.garden.local
    staging: staging.api.garden.com
    prod: api.garden.com

  # Package optimization
  package:
    patterns:
      - '!**/*.test.ts'
      - '!**/*.spec.ts'
      - '!tests/**'
      - '!.github/**'
      - '!.vscode/**'
      - '!*.md'
      - '!serverless.*.yml'

  # ESBuild for fast builds
  esbuild:
    target: node20
    platform: node
    format: cjs
    bundle: true
    minify: true
    sourcemap: true
    exclude:
      - '@aws-sdk/*'
      - 'aws-sdk'
    external:
      - '@prisma/client'

  # Prisma (if using)
  prisma:
    generate: true
    migrate: true

# Functions
functions:
  # Main API Handler (Mono-Lambda pattern)
  api:
    handler: dist/lambda.handler
    timeout: 30
    memorySize: 512
    ephemeralStorage:
      size: 1024
    events:
      - httpApi:
          path: /{proxy+}
          method: '*'
          timeout: 30
    environment:
      LAMBDA_NAME: api

  # Auth-specific functions (separate for security)
  authRegister:
    handler: dist/auth/register.handler
    timeout: 10
    memorySize: 256
    events:
      - httpApi:
          path: /auth/register
          method: post
    environment:
      LAMBDA_NAME: authRegister

  authLogin:
    handler: dist/auth/login.handler
    timeout: 10
    memorySize: 256
    events:
      - httpApi:
          path: /auth/login
          method: post
    environment:
      LAMBDA_NAME: authLogin

  authRefresh:
    handler: dist/auth/refresh.handler
    timeout: 10
    memorySize: 256
    events:
      - httpApi:
          path: /auth/refresh
          method: post
    environment:
      LAMBDA_NAME: authRefresh

  # Webhook handlers
  webhookStripe:
    handler: dist/webhooks/stripe.handler
    timeout: 30
    memorySize: 256
    events:
      - httpApi:
          path: /webhooks/stripe
          method: post
    environment:
      LAMBDA_NAME: webhookStripe

  # Scheduled jobs
  cleanupExpiredTokens:
    handler: dist/jobs/cleanupTokens.handler
    timeout: 60
    memorySize: 256
    events:
      - schedule:
          rate: cron(0 3 * * ? *)  # 3 AM daily
          enabled: ${self:provider.stage != 'dev'}

  # Async processors
  processNotifications:
    handler: dist/processors/notifications.handler
    timeout: 60
    memorySize: 512
    events:
      - sqs:
          arn:
            Fn::GetAtt: [NotificationsQueue, Arn]
          batchSize: 10

# Resources
resources:
  Resources:
    # DynamoDB Main Table
    MainTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:custom.dynamodb.tableName}
        BillingMode: ${self:custom.dynamodb.billingMode}
        AttributeDefinitions:
          - AttributeName: PK
            AttributeType: S
          - AttributeName: SK
            AttributeType: S
          - AttributeName: GSI1PK
            AttributeType: S
          - AttributeName: GSI1SK
            AttributeType: S
          - AttributeName: GSI2PK
            AttributeType: S
          - AttributeName: GSI2SK
            AttributeType: S
        KeySchema:
          - AttributeName: PK
            KeyType: HASH
          - AttributeName: SK
            KeyType: RANGE
        GlobalSecondaryIndexes:
          - IndexName: GSI1
            KeySchema:
              - AttributeName: GSI1PK
                KeyType: HASH
              - AttributeName: GSI1SK
                KeyType: RANGE
            Projection:
              ProjectionType: ALL
          - IndexName: GSI2
            KeySchema:
              - AttributeName: GSI2PK
                KeyType: HASH
              - AttributeName: GSI2SK
                KeyType: RANGE
            Projection:
              ProjectionType: ALL
        PointInTimeRecoverySpecification:
          PointInTimeRecoveryEnabled: true
        SSESpecification:
          SSEEnabled: true

    # S3 Assets Bucket
    AssetsBucket:
      Type: AWS::S3::Bucket
      Properties:
        BucketName: ${self:provider.environment.ASSETS_BUCKET}
        BucketEncryption:
          ServerSideEncryptionConfiguration:
            - ServerSideEncryptionByDefault:
                SSEAlgorithm: AES256
        PublicAccessBlockConfiguration:
          BlockPublicAcls: true
          BlockPublicPolicy: true
          IgnorePublicAcls: true
          RestrictPublicBuckets: true
        VersioningConfiguration:
          Status: Enabled
        LifecycleConfiguration:
          Rules:
            - Id: DeleteOldVersions
              Status: Enabled
              NoncurrentVersionExpirationInDays: 90

    # SQS Queue for Notifications
    NotificationsQueue:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: ${self:service}-notifications-${self:provider.stage}
        VisibilityTimeout: 60
        MessageRetentionPeriod: 1209600  # 14 days
        DeadLetterQueue:
          - TargetArn:
              Fn::GetAtt: [NotificationsDLQ, Arn]
            MaxReceiveCount: 3

    NotificationsDLQ:
      Type: AWS::SQS::Queue
      Properties:
        QueueName: ${self:service}-notifications-dlq-${self:provider.stage}
        MessageRetentionPeriod: 1209600

    # EventBridge Bus
    EventBus:
      Type: AWS::Events::EventBus
      Properties:
        Name: ${self:service}-${self:provider.stage}

    # CloudWatch Log Groups (with retention)
    ApiLogGroup:
      Type: AWS::Logs::LogGroup
      Properties:
        LogGroupName: /aws/lambda/${self:service}-${self:provider.stage}-api
        RetentionInDays: 30

  Outputs:
    ApiUrl:
      Value:
        Fn::Join:
          - ''
          - - 'https://'
            - Ref: HttpApi
            - '.execute-api.${self:provider.region}.amazonaws.com'
      Export:
        Name: ${self:service}-${self:provider.stage}-api-url

    TableName:
      Value:
        Ref: MainTable
      Export:
        Name: ${self:service}-${self:provider.stage}-table-name

# Plugins
plugins:
  - serverless-esbuild
  - serverless-offline
  - serverless-dynamodb-local
  - serverless-prisma
  - serverless-domain-manager
  - serverless-plugin-canary-deployments

# Canary Deployments (for prod)
canaryDeployments:
  enabled: ${self:provider.stage == 'prod'}
  stages:
    - prod
  aliasName: live
  deploymentSettings:
    type: Linear10PercentEvery1Minute
```

### 3.2 Environment-Specific Configs

```yaml
# serverless.dev.yml
# Merged with serverless.yml for dev stage

custom:
  domain:
    dev: dev.api.garden.local

provider:
  logRetentionInDays: 7
  tracing:
    lambda: false  # Save costs in dev

functions:
  api:
    reservedConcurrency: 10  # Limit for dev
```

```yaml
# serverless.prod.yml

custom:
  domain:
    prod: api.garden.com

provider:
  logRetentionInDays: 90

functions:
  api:
    reservedConcurrency: 1000
    provisionedConcurrency: 10  # Eliminate cold starts for critical paths

  authLogin:
    provisionedConcurrency: 5
```

---

## 4. Database Strategy: MongoDB → DynamoDB

### 4.1 Why DynamoDB?
- **Serverless-native**: No connection pooling issues
- **Single-digit ms latency**: Consistent performance
- **Infinite scaling**: Handles any load
- **Cost-effective**: Pay-per-request, free tier 25GB
- **Built-in TTL**: Perfect for session expiration

### 4.2 When to Use DocumentDB
- Complex aggregations (geospatial, text search)
- Transactions across multiple documents
- MongoDB compatibility required
- Large documents (>400KB)

### 4.3 Data Model Mapping

#### Current MongoDB Collections → DynamoDB Single Table Design

| MongoDB Collection | DynamoDB PK/SK Pattern | GSI Usage |
|-------------------|------------------------|-----------|
| `users` | `PK=USER#${email}`, `SK=PROFILE` | GSI1: `EMAIL#${email}` |
| `gardens` | `PK=USER#${userId}`, `SK=GARDEN#${gardenId}` | GSI1: `GARDEN#${gardenId}` |
| `plants` | `PK=GARDEN#${gardenId}`, `SK=PLANT#${plantId}` | GSI2: `PLANT#${plantId}` |
| `logs` | `PK=GARDEN#${gardenId}`, `SK=LOG#${timestamp}#${logId}` | GSI1: `USER#${userId}` |
| `inventory` | `PK=USER#${userId}`, `SK=ITEM#${itemId}` | GSI1: `CATEGORY#${category}` |
| `refreshTokens` | `PK=TOKEN#${jti}`, `SK=META` (TTL: expiresAt) | GSI1: `USER#${userId}` |

### 4.4 Single Table Design Example

```typescript
// src/lib/dynamodb/entity-mapper.ts

export const EntityMapper = {
  // User
  user: {
    pk: (email: string) => `USER#${email.toLowerCase()}`,
    sk: () => 'PROFILE',
    gsi1pk: (email: string) => `EMAIL#${email.toLowerCase()}`,
    gsi1sk: () => 'PROFILE',
    toItem: (user: User) => ({
      PK: EntityMapper.user.pk(user.email),
      SK: EntityMapper.user.sk(),
      GSI1PK: EntityMapper.user.gsi1pk(user.email),
      GSI1SK: EntityMapper.user.gsi1sk(),
      entityType: 'USER',
      email: user.email.toLowerCase(),
      passwordHash: user.passwordHash,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    fromItem: (item: any): User => ({
      id: item.PK.replace('USER#', ''),
      email: item.email,
      passwordHash: item.passwordHash,
      name: item.name,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    }),
  },

  // Garden
  garden: {
    pk: (userId: string) => `USER#${userId}`,
    sk: (gardenId: string) => `GARDEN#${gardenId}`,
    gsi1pk: (gardenId: string) => `GARDEN#${gardenId}`,
    gsi1sk: () => 'DETAIL',
    gsi2pk: (userId: string) => `USER#${userId}`,
    gsi2sk: (gardenId: string) => `GARDEN#${gardenId}`,
    toItem: (garden: Garden, userId: string) => ({
      PK: EntityMapper.garden.pk(userId),
      SK: EntityMapper.garden.sk(garden.id),
      GSI1PK: EntityMapper.garden.gsi1pk(garden.id),
      GSI1SK: EntityMapper.garden.gsi1sk(),
      GSI2PK: EntityMapper.garden.gsi2pk(userId),
      GSI2SK: EntityMapper.garden.gsi2sk(garden.id),
      entityType: 'GARDEN',
      gardenId: garden.id,
      name: garden.name,
      phase: garden.phase,
      environment: garden.environment,
      startDate: garden.startDate.toISOString(),
      plantsCount: garden.plantsCount,
      ownerId: userId,
      createdAt: garden.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    fromItem: (item: any): Garden => ({
      id: item.gardenId,
      name: item.name,
      phase: item.phase,
      environment: item.environment,
      startDate: new Date(item.startDate),
      plantsCount: item.plantsCount,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    }),
  },

  // Plant (embedded in garden or separate)
  plant: {
    pk: (gardenId: string) => `GARDEN#${gardenId}`,
    sk: (plantId: string) => `PLANT#${plantId}`,
    gsi1pk: (plantId: string) => `PLANT#${plantId}`,
    gsi1sk: () => 'DETAIL',
    toItem: (plant: Plant, gardenId: string) => ({
      PK: EntityMapper.plant.pk(gardenId),
      SK: EntityMapper.plant.sk(plant.id),
      GSI1PK: EntityMapper.plant.gsi1pk(plant.id),
      GSI1SK: EntityMapper.plant.gsi1sk(),
      entityType: 'PLANT',
      plantId: plant.id,
      gardenId,
      name: plant.name,
      species: plant.species,
      variety: plant.variety,
      plantedDate: plant.plantedDate.toISOString(),
      expectedHarvestDate: plant.expectedHarvestDate?.toISOString(),
      status: plant.status,
      notes: plant.notes,
      createdAt: plant.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    fromItem: (item: any): Plant => ({
      id: item.plantId,
      name: item.name,
      species: item.species,
      variety: item.variety,
      plantedDate: new Date(item.plantedDate),
      expectedHarvestDate: item.expectedHarvestDate ? new Date(item.expectedHarvestDate) : null,
      status: item.status,
      notes: item.notes,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    }),
  },

  // Log
  log: {
    pk: (gardenId: string) => `GARDEN#${gardenId}`,
    sk: (timestamp: Date, logId: string) => `LOG#${timestamp.toISOString()}#${logId}`,
    gsi1pk: (userId: string) => `USER#${userId}`,
    gsi1sk: (timestamp: Date) => `LOG#${timestamp.toISOString()}`,
    toItem: (log: Log, gardenId: string, userId: string) => ({
      PK: EntityMapper.log.pk(gardenId),
      SK: EntityMapper.log.sk(log.date, log.id),
      GSI1PK: EntityMapper.log.gsi1pk(userId),
      GSI1SK: EntityMapper.log.gsi1sk(log.date),
      entityType: 'LOG',
      logId: log.id,
      gardenId,
      type: log.type,
      title: log.title,
      description: log.description,
      date: log.date.toISOString(),
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    fromItem: (item: any): Log => ({
      id: item.logId,
      gardenId: item.gardenId,
      type: item.type,
      title: item.title,
      description: item.description,
      date: new Date(item.date),
      metadata: item.metadata,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    }),
  },

  // Inventory Item
  inventoryItem: {
    pk: (userId: string) => `USER#${userId}`,
    sk: (itemId: string) => `ITEM#${itemId}`,
    gsi1pk: (category: string) => `CATEGORY#${category}`,
    gsi1sk: (itemId: string) => `ITEM#${itemId}`,
    toItem: (item: InventoryItem, userId: string) => ({
      PK: EntityMapper.inventoryItem.pk(userId),
      SK: EntityMapper.inventoryItem.sk(item.id),
      GSI1PK: EntityMapper.inventoryItem.gsi1pk(item.category),
      GSI1SK: EntityMapper.inventoryItem.gsi1sk(item.id),
      entityType: 'INVENTORY_ITEM',
      itemId: item.id,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unit: item.unit,
      minStock: item.minStock,
      location: item.location,
      notes: item.notes,
      lastUpdated: item.lastUpdated.toISOString(),
      ownerId: userId,
      createdAt: item.createdAt.toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    fromItem: (item: any): InventoryItem => ({
      id: item.itemId,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unit: item.unit,
      minStock: item.minStock,
      location: item.location,
      notes: item.notes,
      lastUpdated: new Date(item.lastUpdated),
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    }),
  },

  // Refresh Token (with TTL)
  refreshToken: {
    pk: (jti: string) => `TOKEN#${jti}`,
    sk: () => 'META',
    gsi1pk: (userId: string) => `USER#${userId}`,
    gsi1sk: (jti: string) => `TOKEN#${jti}`,
    toItem: (token: RefreshToken) => ({
      PK: EntityMapper.refreshToken.pk(token.jti),
      SK: EntityMapper.refreshToken.sk(),
      GSI1PK: EntityMapper.refreshToken.gsi1pk(token.userId),
      GSI1SK: EntityMapper.refreshToken.gsi1sk(token.jti),
      entityType: 'REFRESH_TOKEN',
      jti: token.jti,
      userId: token.userId,
      hashedToken: token.hashedToken,
      expiresAt: token.expiresAt.toISOString(),
      revokedAt: token.revokedAt?.toISOString(),
      replacedByJti: token.replacedByJti,
      // TTL for auto-expiration (DynamoDB native)
      ttl: Math.floor(token.expiresAt.getTime() / 1000),
    }),
    fromItem: (item: any): RefreshToken => ({
      jti: item.jti,
      userId: item.userId,
      hashedToken: item.hashedToken,
      expiresAt: new Date(item.expiresAt),
      revokedAt: item.revokedAt ? new Date(item.revokedAt) : null,
      replacedByJti: item.replacedByJti,
    }),
  },
};
```

### 4.5 Repository Implementation (DynamoDB)

```typescript
// src/repositories/dynamodb/garden.repository.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { EntityMapper } from '../../lib/dynamodb/entity-mapper';

export class DynamoDBGardenRepository {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    const ddbClient = new DynamoDBClient({ region: process.env.REGION });
    this.client = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
    });
    this.tableName = process.env.DYNAMODB_TABLE!;
  }

  async findById(gardenId: string, userId: string): Promise<Garden | null> {
    const result = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: {
        PK: EntityMapper.garden.pk(userId),
        SK: EntityMapper.garden.sk(gardenId),
      },
    }));
    return result.Item ? EntityMapper.garden.fromItem(result.Item) : null;
  }

  async findByUserId(userId: string, filters: GardenFilters = {}): Promise<Garden[]> {
    const { phase, environment, limit = 20, lastKey } = filters;

    let keyCondition = 'PK = :pk AND begins_with(SK, :sk)';
    const expressionAttributeValues: any = {
      ':pk': EntityMapper.garden.pk(userId),
      ':sk': 'GARDEN#',
    };

    if (phase) {
      keyCondition += ' AND #phase = :phase';
      expressionAttributeValues[':phase'] = phase;
    }
    if (environment) {
      keyCondition += ' AND #env = :env';
      expressionAttributeValues[':env'] = environment;
    }

    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeNames: {
        '#phase': 'phase',
        '#env': 'environment',
      },
      ExpressionAttributeValues: expressionAttributeValues,
      Limit: limit,
      ExclusiveStartKey: lastKey,
      ScanIndexForward: false, // Descending by SK (creation date)
    }));

    return {
      items: result.Items?.map(EntityMapper.garden.fromItem) || [],
      lastKey: result.LastEvaluatedKey,
    };
  }

  async create(garden: Garden, userId: string): Promise<Garden> {
    const item = EntityMapper.garden.toItem(garden, userId);
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(PK)', // Prevent overwrite
    }));
    return garden;
  }

  async update(gardenId: string, userId: string, updates: Partial<Garden>): Promise<Garden | null> {
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {
      ':updatedAt': new Date().toISOString(),
    };

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        const attrName = `#${key}`;
        const attrValue = `:${key}`;
        updateExpressions.push(`${attrName} = ${attrValue}`);
        expressionAttributeNames[attrName] = key;
        expressionAttributeValues[attrValue] = value;
      }
    });

    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';

    try {
      const result = await this.client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: EntityMapper.garden.pk(userId),
          SK: EntityMapper.garden.sk(gardenId),
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
        ConditionExpression: 'attribute_exists(PK)',
      }));
      return result.Attributes ? EntityMapper.garden.fromItem(result.Attributes) : null;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') return null;
      throw error;
    }
  }

  async delete(gardenId: string, userId: string): Promise<boolean> {
    // Transaction: Delete garden + all plants + all logs
    const gardenKey = {
      PK: EntityMapper.garden.pk(userId),
      SK: EntityMapper.garden.sk(gardenId),
    };

    // Query plants to delete
    const plants = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': EntityMapper.plant.pk(gardenId),
        ':sk': 'PLANT#',
      },
    }));

    // Query logs to delete
    const logs = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GARDEN#${gardenId}`,
        ':sk': 'LOG#',
      },
    }));

    const transactItems = [
      { Delete: { TableName: this.tableName, Key: gardenKey, ConditionExpression: 'attribute_exists(PK)' } },
      ...(plants.Items || []).map(item => ({
        Delete: { TableName: this.tableName, Key: { PK: item.PK, SK: item.SK } },
      })),
      ...(logs.Items || []).map(item => ({
        Delete: { TableName: this.tableName, Key: { PK: item.PK, SK: item.SK } },
      })),
    ];

    try {
      await this.client.send(new TransactWriteCommand({
        TransactItems: transactItems,
      }));
      return true;
    } catch (error: any) {
      if (error.name === 'TransactionCanceledException') return false;
      throw error;
    }
  }
}
```

---

## 5. Authentication & Authorization

### 5.1 AWS Cognito Configuration

```yaml
# resources/cognito.yml (CloudFormation nested stack)
Resources:
  UserPool:
    Type: AWS::Cognito::UserPool
    Properties:
      UserPoolName: ${self:service}-${self:provider.stage}
      Policies:
        PasswordPolicy:
          MinimumLength: 8
          RequireUppercase: true
          RequireLowercase: true
          RequireNumbers: true
          RequireSymbols: true
      AutoVerifiedAttributes:
        - email
      UsernameAttributes:
        - email
      AccountRecoverySetting:
        RecoveryMechanisms:
          - Name: verified_email
            Priority: 1
      Schema:
        - Name: name
          AttributeDataType: String
          Required: true
          Mutable: true
      LambdaConfig:
        PreSignUp: !GetAtt PreSignUpLambda.Arn
        PostAuthentication: !GetAtt PostAuthLambda.Arn
        PreTokenGeneration: !GetAtt PreTokenGenLambda.Arn

  UserPoolClient:
    Type: AWS::Cognito::UserPoolClient
    Properties:
      ClientName: ${self:service}-web
      UserPoolId: !Ref UserPool
      ExplicitAuthFlows:
        - ALLOW_USER_PASSWORD_AUTH
        - ALLOW_REFRESH_TOKEN_AUTH
        - ALLOW_USER_SRP_AUTH
      PreventUserExistenceErrors: ENABLED
      RefreshTokenValidity: 30  # days
      AccessTokenValidity: 60   # minutes
      IdTokenValidity: 60       # minutes
      TokenValidityUnits:
        AccessToken: minutes
        IdToken: minutes
        RefreshToken: days

  UserPoolDomain:
    Type: AWS::Cognito::UserPoolDomain
    Properties:
      Domain: ${self:service}-${self:provider.stage}
      UserPoolId: !Ref UserPool

  # Lambda Triggers
  PreSignUpLambda:
    Type: AWS::Lambda::Function
    Properties:
      Handler: dist/auth/triggers/preSignUp.handler
      Role: !GetAtt LambdaExecutionRole.Arn
      Code:
        S3Bucket: !Ref DeploymentBucket
        S3Key: !Ref DeploymentPackage
      Runtime: nodejs20.x
```

### 5.2 JWT Token Management

```typescript
// src/lib/auth/jwt.ts
import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({ region: process.env.REGION });

let accessSecret: Uint8Array;
let refreshSecret: Uint8Array;

async function loadSecrets() {
  if (accessSecret && refreshSecret) return;

  const [accessResp, refreshResp] = await Promise.all([
    secretsClient.send(new GetSecretValueCommand({ SecretId: process.env.JWT_ACCESS_SECRET_ARN })),
    secretsClient.send(new GetSecretValueCommand({ SecretId: process.env.JWT_REFRESH_SECRET_ARN })),
  ]);

  accessSecret = new TextEncoder().encode(accessResp.SecretString!);
  refreshSecret = new TextEncoder().encode(refreshResp.SecretString!);
}

export interface TokenPayload extends JWTPayload {
  sub: string;        // userId
  email: string;
  jti: string;        // JWT ID for refresh token tracking
  type: 'access' | 'refresh';
}

export async function generateAccessToken(userId: string, email: string): Promise<string> {
  await loadSecrets();
  const jti = crypto.randomUUID();
  
  return new SignJWT({ sub: userId, email, jti, type: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setJti(jti)
    .sign(accessSecret);
}

export async function generateRefreshToken(userId: string, email: string): Promise<{ token: string; jti: string; expiresAt: Date }> {
  await loadSecrets();
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const token = await new SignJWT({ sub: userId, email, jti, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .setJti(jti)
    .sign(refreshSecret);

  return { token, jti, expiresAt };
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  await loadSecrets();
  const { payload } = await jwtVerify(token, accessSecret, {
    issuer: 'garden-api',
    audience: 'garden-app',
  });
  return payload as unknown as TokenPayload;
}

export async function verifyRefreshToken(token: string): Promise<TokenPayload> {
  await loadSecrets();
  const { payload } = await jwtVerify(token, refreshSecret, {
    issuer: 'garden-api',
    audience: 'garden-app',
  });
  return payload as unknown as TokenPayload;
}
```

### 5.3 API Gateway Authorizer

```typescript
// src/lib/auth/authorizer.ts
import { APIGatewayTokenAuthorizerHandler } from 'aws-lambda';
import { verifyAccessToken } from './jwt';

export const handler: APIGatewayTokenAuthorizerHandler = async (event) => {
  const token = event.authorizationToken?.replace('Bearer ', '');
  
  if (!token) {
    return denyAll(event.methodArn);
  }

  try {
    const payload = await verifyAccessToken(token);
    
    // Fetch user from DynamoDB for additional context (roles, permissions)
    // const user = await userRepository.findById(payload.sub);
    
    return {
      principalId: payload.sub,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: event.methodArn.replace(/\/[^\/]*$/, '/*'),
          },
        ],
      },
      context: {
        userId: payload.sub,
        email: payload.email,
        jti: payload.jti,
        // roles: user.roles.join(','),
      },
    };
  } catch (error) {
    console.warn('Token verification failed:', error);
    return denyAll(event.methodArn);
  }
};

function denyAll(methodArn: string) {
  return {
    principalId: 'unauthorized',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Deny',
          Resource: methodArn,
        },
      ],
    },
  };
}
```

```yaml
# Add to serverless.yml functions
functions:
  authorizer:
    handler: dist/lib/auth/authorizer.handler
    timeout: 10
    memorySize: 128

# Use in HTTP API
# (HTTP APIs use Lambda authorizers via $default route or specific routes)
```

---

## 6. API Layer: API Gateway + Lambda

### 6.1 HTTP API vs REST API

| Feature | HTTP API | REST API |
|---------|----------|----------|
| **Cost** | $1.00/million | $3.50/million |
| **Latency** | Lower | Higher |
| **Features** | Basic | Full (WAF, custom domains, etc.) |
| **WebSocket** | No | Yes |
| **Recommendation** | **Use HTTP API** | Only if needed |

### 6.2 Lambda Handler Structure

```typescript
// src/lambda.ts - Main entry point (Mono-Lambda)
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { createServer } from 'http';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// Import Express app
import app from './app.js';

// For Lambda, we need to adapt Express to Lambda event format
// Use @vendia/serverless-express or @aws-lambda-powertools

import { serverlessExpress } from '@vendia/serverless-express';

let cachedServer: ReturnType<typeof serverlessExpress>;

// Initialize Express app once (cold start)
async function initServer() {
  if (cachedServer) return cachedServer;
  
  // Initialize database connections, etc.
  await initializeApp();
  
  cachedServer = serverlessExpress({ app });
  return cachedServer;
}

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: any
): Promise<APIGatewayProxyResultV2> => {
  // Set timeout context
  context.callbackWaitsForEmptyEventLoop = false;
  
  const server = await initServer();
  return server(event, context);
};

// For local development
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}
```

### 6.3 Route-Specific Lambdas (Alternative Pattern)

```typescript
// src/auth/login.ts - Separate Lambda for security
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { LoginUser } from '../use-cases/auth/LoginUser.js';
import { DynamoDBUserRepository } from '../repositories/dynamodb/user.repository.js';
import { DynamoDBRefreshTokenRepository } from '../repositories/dynamodb/refreshToken.repository.js';
import { generateAccessToken, generateRefreshToken } from '../lib/auth/jwt.js';
import { logger } from '../lib/logger.js';

const userRepo = new DynamoDBUserRepository();
const tokenRepo = new DynamoDBRefreshTokenRepository();
const loginUser = new LoginUser(userRepo, tokenRepo);

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { email, password } = body;

    // Rate limiting check (can use API Gateway usage plans)
    
    const result = await loginUser.execute({ email, password });
    
    // Generate JWT tokens
    const accessToken = await generateAccessToken(result.user.id, result.user.email);
    const { token: refreshToken, jti, expiresAt } = await generateRefreshToken(result.user.id, result.user.email);

    // Store refresh token
    await tokenRepo.create({
      jti,
      userId: result.user.id,
      hashedToken: await hashToken(refreshToken),
      expiresAt,
    });

    logger.info({ userId: result.user.id }, 'User logged in');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken,
        refreshToken,
        user: { id: result.user.id, email: result.user.email, name: result.user.name },
      }),
    };
  } catch (error: any) {
    logger.error({ err: error, email: event.body ? JSON.parse(event.body).email : 'unknown' }, 'Login failed');
    
    const statusCode = error.statusCode || 500;
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
```

### 6.4 Shared Middleware Layer

```typescript
// src/lib/middleware/common.ts
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../logger.js';
import { verifyAccessToken } from '../auth/jwt.js';

export interface AuthenticatedEvent extends APIGatewayProxyEventV2 {
  user: {
    userId: string;
    email: string;
    jti: string;
  };
}

export function withAuth(
  handler: (event: AuthenticatedEvent) => Promise<APIGatewayProxyResultV2>
) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return unauthorized('Missing or invalid Authorization header');
    }

    try {
      const token = authHeader.slice(7);
      const payload = await verifyAccessToken(token);
      
      // Attach user to event
      (event as AuthenticatedEvent).user = {
        userId: payload.sub,
        email: payload.email,
        jti: payload.jti,
      };
    } catch (error) {
      return unauthorized('Invalid or expired token');
    }

    return handler(event as AuthenticatedEvent);
  };
}

export function withValidation<T>(
  schema: any,
  handler: (event: APIGatewayProxyEventV2 & { validatedBody: T }) => Promise<APIGatewayProxyResultV2>
) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      const validated = await schema.validate(body, { abortEarly: false, stripUnknown: true });
      (event as any).validatedBody = validated;
    } catch (error: any) {
      return badRequest(error.errors?.join(', ') || 'Validation failed');
    }
    return handler(event as any);
  };
}

export function withRateLimit(
  limit: number,
  windowMs: number,
  handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>
) {
  // Implement with DynamoDB or use API Gateway Usage Plans
  return handler;
}

function unauthorized(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 401, body: JSON.stringify({ error: message }), headers: { 'Content-Type': 'application/json' } };
}

function badRequest(message: string): APIGatewayProxyResultV2 {
  return { statusCode: 400, body: JSON.stringify({ error: message }), headers: { 'Content-Type': 'application/json' } };
}
```

---

## 7. Observability: CloudWatch + X-Ray

### 7.1 Structured Logging with EMF

```typescript
// src/lib/logger.ts
import { createLogger, Logger } from '@aws-lambda-powertools/logger';

export const logger = createLogger({
  serviceName: 'garden-api',
  logLevel: process.env.LOG_LEVEL || 'info',
  // EMF (Embedded Metric Format) for CloudWatch Metrics
  // See: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html
  samplingRate: process.env.STAGE === 'prod' ? 0.1 : 1.0,
});

// Middleware to add request context
export function withLogging<T extends { userId?: string }>(
  handler: (event: T) => Promise<any>
) {
  return async (event: T) => {
    // Add persistent keys
    logger.appendKeys({
      requestId: event.requestContext?.requestId,
      userId: event.user?.userId,
      stage: process.env.STAGE,
    });

    const startTime = Date.now();
    
    try {
      const result = await handler(event);
      
      // Emit EMF metric for latency
      logger.addMetric('HttpLatency', 'Milliseconds', Date.now() - startTime);
      logger.addMetric('HttpStatusCode', 'Count', result?.statusCode || 200, 'Count');
      
      return result;
    } catch (error: any) {
      logger.addMetric('HttpErrors', 'Count', 1);
      logger.error('Handler error', { error: error.message, stack: error.stack });
      throw error;
    } finally {
      logger.flush(); // Ensure logs are sent
    }
  };
}

// Business metrics
export function emitBusinessMetric(name: string, value: number, unit: string = 'Count', dimensions?: Record<string, string>) {
  logger.addMetric(name, unit as any, value, dimensions);
}

// Usage in handlers
// logger.addMetric('GardenCreated', 'Count', 1, { userId, phase: garden.phase });
```

### 7.2 X-Ray Tracing

```typescript
// src/lib/tracing.ts
import { captureAWSv3Client } from 'aws-xray-sdk-core';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

// Capture AWS SDK clients
export const tracedDynamoClient = captureAWSv3Client(new DynamoDBClient({ region: process.env.REGION }));
export const tracedSecretsClient = captureAWSv3Client(new SecretsManagerClient({ region: process.env.REGION }));

// Manual segment for custom operations
import { getSegment, Segment } from 'aws-xray-sdk-core';

export function traceAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const segment = getSegment();
  if (!segment) return fn();

  const subsegment = segment.addNewSubsegment(name);
  return fn()
    .then(result => {
      subsegment.close();
      return result;
    })
    .catch(error => {
      subsegment.addError(error);
      subsegment.close();
      throw error;
    });
}

// Annotate current segment
export function annotate(key: string, value: string | number | boolean) {
  const segment = getSegment();
  segment?.addAnnotation(key, value);
}

export function addMetadata(key: string, value: any, namespace: string = 'default') {
  const segment = getSegment();
  segment?.addMetadata(key, value, namespace);
}
```

### 7.3 CloudWatch Dashboard (Generated)

```yaml
# resources/monitoring.yml
Resources:
  GardenApiDashboard:
    Type: AWS::CloudWatch::Dashboard
    Properties:
      DashboardName: ${self:service}-${self:provider.stage}
      DashboardBody: !Sub |
        {
          "widgets": [
            {
              "type": "metric",
              "properties": {
                "metrics": [
                  ["AWS/Lambda", "Invocations", "FunctionName", "${self:service}-${self:provider.stage}-api"],
                  [".", "Errors", ".", "."],
                  [".", "Duration", ".", "."],
                  [".", "Throttles", ".", "."]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${self:provider.region}",
                "title": "Lambda Metrics",
                "period": 300
              }
            },
            {
              "type": "metric",
              "properties": {
                "metrics": [
                  ["AWS/ApiGateway", "Count", "ApiName", "${self:service}-${self:provider.stage}"],
                  [".", "5XXError", ".", "."],
                  [".", "Latency", ".", "."]
                ],
                "view": "timeSeries",
                "region": "${self:provider.region}",
                "title": "API Gateway Metrics",
                "period": 60
              }
            },
            {
              "type": "metric",
              "properties": {
                "metrics": [
                  ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", "${self:custom.dynamodb.tableName}"],
                  [".", "ConsumedWriteCapacityUnits", ".", "."],
                  [".", "ThrottledRequests", ".", "."],
                  [".", "SystemErrors", ".", "."]
                ],
                "view": "timeSeries",
                "region": "${self:provider.region}",
                "title": "DynamoDB Metrics",
                "period": 300
              }
            },
            {
              "type": "log",
              "properties": {
                "query": "SOURCE '/aws/lambda/${self:service}-${self:provider.stage}-api' | filter @message /ERROR/ | stats count() by bin(5m)",
                "region": "${self:provider.region}",
                "title": "Error Rate (5min)",
                "view": "timeSeries"
              }
            }
          ]
        }

  # Alarms
  LambdaErrorAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: ${self:service}-${self:provider.stage}-lambda-errors
      AlarmDescription: Lambda error rate > 1%
      MetricName: Errors
      Namespace: AWS/Lambda
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 2
      Threshold: 10
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: FunctionName
          Value: ${self:service}-${self:provider.stage}-api
      AlarmActions:
        - !Ref AlertTopic

  ApiLatencyAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: ${self:service}-${self:provider.stage}-api-latency
      MetricName: Latency
      Namespace: AWS/ApiGateway
      Statistic: p99
      Period: 60
      EvaluationPeriods: 3
      Threshold: 2000  # 2 seconds
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: ApiName
          Value: ${self:service}-${self:provider.stage}
      AlarmActions:
        - !Ref AlertTopic

  DynamoDBThrottleAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: ${self:service}-${self:provider.stage}-dynamodb-throttles
      MetricName: ThrottledRequests
      Namespace: AWS/DynamoDB
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 1
      Threshold: 5
      ComparisonOperator: GreaterThanThreshold
      Dimensions:
        - Name: TableName
          Value: ${self:custom.dynamodb.tableName}
      AlarmActions:
        - !Ref AlertTopic

  AlertTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: ${self:service}-${self:provider.stage}-alerts
      Subscription:
        - Protocol: email
          Endpoint: ${ssm:/${self:service}/${self:provider.stage}/alerts/email}
```

---

## 8. CI/CD Pipeline

### 8.1 GitHub Actions Workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy to AWS

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      stage:
        description: 'Deployment stage'
        required: true
        default: 'dev'
        type: choice
        options: [dev, staging, prod]

env:
  AWS_REGION: us-east-1
  NODE_VERSION: '20'

permissions:
  id-token: write
  contents: read

jobs:
  test:
    name: Test & Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run type check
        run: npm run typecheck
      
      - name: Run unit tests
        run: npm run test:unit
      
      - name: Run integration tests
        run: npm run test:integration
        env:
          MONGO_URI: mongodb://localhost:27017/test
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info

  build:
    name: Build & Package
    needs: test
    runs-on: ubuntu-latest
    outputs:
      artifact-url: ${{ steps.upload.outputs.artifact-url }}
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
        env:
          STAGE: ${{ github.event.inputs.stage || github.ref == 'refs/heads/main' && 'prod' || 'dev' }}
      
      - name: Package Serverless
        run: npx serverless package --stage ${{ github.event.inputs.stage || github.ref == 'refs/heads/main' && 'prod' || 'dev' }} --package .serverless
      
      - name: Upload artifact
        id: upload
        uses: actions/upload-artifact@v4
        with:
          name: serverless-package
          path: .serverless/
          retention-days: 7

  deploy-dev:
    name: Deploy to Dev
    needs: build
    if: github.ref == 'refs/heads/develop' || github.event.inputs.stage == 'dev'
    runs-on: ubuntu-latest
    environment: dev
    steps:
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/GitHubActions-Deploy
          aws-region: ${{ env.AWS_REGION }}
      
      - name: Download artifact
        uses: actions/download-artifact@v4
        with:
          name: serverless-package
          path: .serverless/
      
      - name: Deploy
        run: npx serverless deploy --stage dev --package .serverless
        env:
          AWS_REGION: ${{ env.AWS_REGION }}

  deploy-staging:
    name: Deploy to Staging
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/GitHubActions-Deploy
          aws-region: ${{ env.AWS_REGION }}
      
      - name: Download artifact
        uses: actions/download-artifact@v4
        with:
          name: serverless-package
          path: .serverless/
      
      - name: Deploy
        run: npx serverless deploy --stage staging --package .serverless
        env:
          AWS_REGION: ${{ env.AWS_REGION }}

  deploy-prod:
    name: Deploy to Prod
    needs: deploy-staging
    if: github.event.workflow_dispatch && github.event.inputs.stage == 'prod'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/GitHubActions-Deploy
          aws-region: ${{ env.AWS_REGION }}
      
      - name: Download artifact
        uses: actions/download-artifact@v4
        with:
          name: serverless-package
          path: .serverless/
      
      - name: Deploy with Canary
        run: npx serverless deploy --stage prod --package .serverless
        env:
          AWS_REGION: ${{ env.AWS_REGION }}

  notify:
    name: Notify
    needs: [deploy-dev, deploy-staging, deploy-prod]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Send Slack notification
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          channel: '#deployments'
          text: 'Garden API deployment ${{ job.status }}'
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### 8.2 IAM Role for GitHub Actions (OIDC)

```yaml
# infrastructure/github-actions-role.yml
Resources:
  GitHubActionsRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: GitHubActions-Deploy
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Federated: !Ref GitHubOIDCProvider
            Action: sts:AssumeRoleWithWebIdentity
            Condition:
              StringLike:
                'token.actions.githubusercontent.com:sub': 'repo:your-org/garden-api:*'
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/PowerUserAccess  # Or custom least-privilege policy
      Tags:
        - Key: Purpose
          Value: GitHub Actions Deployment

  GitHubOIDCProvider:
    Type: AWS::IAM::OIDCProvider
    Properties:
      Url: https://token.actions.githubusercontent.com
      ClientIdList:
        - sts.amazonaws.com
      ThumbprintList:
        - "6938fd4d98bab03faadb97b34396831e3780aea1"  # GitHub's thumbprint
```

---

## 9. Local Development & Testing

### 9.1 LocalStack Configuration

```yaml
# docker-compose.local.yml
version: '3.8'

services:
  localstack:
    image: localstack/localstack:3.0
    container_name: garden-localstack
    ports:
      - "4566:4566"      # Edge port
      - "4510-4559:4510-4559"  # Service ports
    environment:
      - SERVICES=lambda,dynamodb,apigateway,s3,sqs,sns,secretsmanager,cloudformation,iam,sts,logs,events
      - DEBUG=1
      - LAMBDA_EXECUTOR=docker-reuse
      - DOCKER_HOST=unix:///var/run/docker.sock
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock"
      - "./localstack:/etc/localstack/init/ready.d"
      - "localstack-data:/var/lib/localstack"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4566/_localstack/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  # DynamoDB Admin UI
  dynamodb-admin:
    image: aaronshaf/dynamodb-admin
    container_name: garden-dynamodb-admin
    ports:
      - "8001:8001"
    environment:
      - DYNAMO_ENDPOINT=http://localstack:4566
      - AWS_REGION=us-east-1
    depends_on:
      - localstack

volumes:
  localstack-data:
```

```bash
# Start local environment
docker-compose -f docker-compose.local.yml up -d

# Deploy to local
AWS_ENDPOINT_URL=http://localhost:4566 \
AWS_ACCESS_KEY_ID=test \
AWS_SECRET_ACCESS_KEY=test \
npx serverless deploy --stage local --region us-east-1
```

### 9.2 Serverless Offline

```json
// package.json scripts
{
  "scripts": {
    "dev": "serverless offline start --stage local --httpPort 3000 --lambdaPort 3002",
    "dev:debug": "serverless offline start --stage local --httpPort 3000 --lambdaPort 3002 --inspect=9229",
    "test:local": "serverless invoke local --stage local --function api --path tests/mocks/event.json",
    "db:local": "serverless dynamodb start --stage local --migrate --port 8000"
  }
}
```

```yaml
# serverless.local.yml (extends serverless.yml)
custom:
  dynamodb:
    stages:
      - local
    start:
      port: 8000
      inMemory: true
      migrate: true
      seed: true
    seed:
      domain:
        - sources:
            - table: ${self:custom.dynamodb.tableName}
              sources: [./seeds/local/*.json]

  serverless-offline:
    httpPort: 3000
    lambdaPort: 3002
    noPrependStageInUrl: true
    useChildProcesses: true
    layersDir: .serverless/layers
```

### 9.3 Local Seed Data

```json
// seeds/local/users.json
[
  {
    "PutRequest": {
      "Item": {
        "PK": "USER#dev@garden.com",
        "SK": "PROFILE",
        "GSI1PK": "EMAIL#dev@garden.com",
        "GSI1SK": "PROFILE",
        "entityType": "USER",
        "email": "dev@garden.com",
        "passwordHash": "$2a$10$...",
        "name": "Dev User",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    }
  }
]
```

### 9.4 Integration Testing

```typescript
// tests/integration/api.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HttpApi } from '@aws-sdk/client-apigatewayv2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const IS_LOCAL = BASE_URL.includes('localhost');

describe('API Integration Tests', () => {
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    if (IS_LOCAL) {
      // Wait for local services
      await waitForService(`${BASE_URL}/health`);
    }
  });

  describe('Auth', () => {
    it('should register a new user', async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `test-${Date.now()}@example.com`,
          password: 'SecurePass123!',
        }),
      });
      
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();
      authToken = data.accessToken;
      userId = data.user.id;
    });

    it('should login with existing user', async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'dev@garden.com',
          password: 'password123',
        }),
      });
      
      expect(res.status).toBe(200);
      const data = await res.json();
      authToken = data.accessToken;
    });
  });

  describe('Gardens CRUD', () => {
    let gardenId: string;

    it('should create a garden', async () => {
      const res = await fetch(`${BASE_URL}/api/gardens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          name: 'Test Garden',
          phase: 'planning',
          environment: 'indoor',
          startDate: '2024-03-01',
        }),
      });
      
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBeDefined();
      gardenId = data.id;
    });

    it('should list gardens', async () => {
      const res = await fetch(`${BASE_URL}/api/gardens`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should get garden by ID', async () => {
      const res = await fetch(`${BASE_URL}/api/gardens/${gardenId}`, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe(gardenId);
    });

    it('should update garden', async () => {
      const res = await fetch(`${BASE_URL}/api/gardens/${gardenId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ name: 'Updated Garden' }),
      });
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe('Updated Garden');
    });

    it('should delete garden', async () => {
      const res = await fetch(`${BASE_URL}/api/gardens/${gardenId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      
      expect(res.status).toBe(204);
    });
  });
});

async function waitForService(url: string, retries = 30): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Service at ${url} not ready after ${retries}s`);
}
```

---

## 10. Security Best Practices

### 10.1 Infrastructure Security

```yaml
# Security headers via CloudFront or API Gateway
# serverless.yml - HTTP API with custom domain
custom:
  customDomain:
    domainName: ${self:custom.domain.${self:provider.stage}}
    basePath: ''
    certificateArn: ${ssm:/${self:service}/${self:provider.stage}/acm/certificateArn}
    createRoute53Record: true
    endpointType: regional
    securityPolicy: TLS_1_2
    mutualTlsAuthentication:
      truststoreUri: ${ssm:/${self:service}/${self:provider.stage}/acm/truststoreUri}

# WAF for production
resources:
  Resources:
    WebACL:
      Type: AWS::WAFv2::WebACL
      Properties:
        Name: ${self:service}-${self:provider.stage}-waf
        Scope: REGIONAL
        DefaultAction:
          Allow: {}
        Rules:
          - Name: AWSManagedRulesCommonRuleSet
            Priority: 1
            OverrideAction:
              None: {}
            Statement:
              ManagedRuleGroupStatement:
                VendorName: AWS
                Name: AWSManagedRulesCommonRuleSet
            VisibilityConfig:
              SampledRequestsEnabled: true
              CloudWatchMetricsEnabled: true
              MetricName: CommonRuleSet
          - Name: AWSManagedRulesKnownBadInputsRuleSet
            Priority: 2
            Statement:
              ManagedRuleGroupStatement:
                VendorName: AWS
                Name: AWSManagedRulesKnownBadInputsRuleSet
            VisibilityConfig:
              SampledRequestsEnabled: true
              CloudWatchMetricsEnabled: true
              MetricName: KnownBadInputs
          - Name: RateLimit
            Priority: 3
            Action:
              Block: {}
            Statement:
              RateBasedStatement:
                Limit: 2000
                AggregateKeyType: IP
            VisibilityConfig:
              SampledRequestsEnabled: true
              CloudWatchMetricsEnabled: true
              MetricName: RateLimit

    WebACLAssociation:
      Type: AWS::WAFv2::WebACLAssociation
      Properties:
        ResourceArn: !GetAtt HttpApi.Arn
        WebACLArn: !GetAtt WebACL.Arn
```

### 10.2 Secrets Management

```typescript
// src/lib/secrets.ts
import { SecretsManagerClient, GetSecretValueCommand, RotationRulesType } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: process.env.REGION });

const secretCache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getSecret(secretName: string): Promise<string> {
  const cached = secretCache.get(secretName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
  const value = response.SecretString!;
  
  secretCache.set(secretName, { value, expiresAt: Date.now() + CACHE_TTL });
  return value;
}

export async function getSecretJSON<T>(secretName: string): Promise<T> {
  const value = await getSecret(secretName);
  return JSON.parse(value);
}

// Usage
// const dbCreds = await getSecretJSON<{ username: string; password: string }>('/garden/prod/rds/credentials');
```

### 10.3 Lambda Security

```typescript
// Security headers middleware
export function securityHeaders(
  handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>
) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const result = await handler(event);
    
    return {
      ...result,
      headers: {
        ...result.headers,
        // Security headers
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
        // Remove server header
        'Server': undefined,
      },
    };
  };
}

// Input sanitization
import { sanitize } from 'isomorphic-dompurify';

export function sanitizeInput<T>(
  handler: (event: APIGatewayProxyEventV2 & { sanitizedBody: T }) => Promise<APIGatewayProxyResultV2>
) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    if (event.body) {
      try {
        const parsed = JSON.parse(event.body);
        // Recursively sanitize strings
        const sanitized = sanitizeObject(parsed);
        (event as any).sanitizedBody = sanitized;
      } catch {
        // Invalid JSON, let validation handle it
      }
    }
    return handler(event as any);
  };
}

function sanitizeObject(obj: any): any {
  if (typeof obj === 'string') {
    return sanitize(obj, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeObject(value);
    }
    return result;
  }
  return obj;
}
```

---

## 11. Cost Optimization

### 11.1 Cost Breakdown (Estimated Monthly - US East 1)

| Service | Dev | Staging | Prod (10k MAU) |
|---------|-----|---------|----------------|
| **Lambda** | $0.50 | $2.00 | $15.00 |
| **API Gateway (HTTP)** | $0.30 | $1.00 | $5.00 |
| **DynamoDB** | $0.00 (free tier) | $1.50 | $25.00 |
| **DocumentDB** | - | $50.00 | $200.00 |
| **ElastiCache** | - | $15.00 | $60.00 |
| **CloudWatch** | $0.50 | $3.00 | $15.00 |
| **X-Ray** | $0.00 | $2.00 | $10.00 |
| **S3** | $0.01 | $0.10 | $2.00 |
| **Cognito** | $0.00 (free tier) | $0.00 | $0.50 |
| **Total** | **~$1.30** | **~$74.60** | **~$332.50** |

### 11.2 Optimization Strategies

```yaml
# serverless.yml optimizations

# 1. Right-size Lambda memory
functions:
  api:
    memorySize: 512  # Start here, adjust based on profiling
    # Use AWS Lambda Power Tuning to find optimal
  
  # 2. Provisioned concurrency for critical paths
  authLogin:
    provisionedConcurrency: 5  # Only for prod
    # Cost: ~$0.015/GB-hour * 5 * 24 * 30 = $5.40/month
  
  # 3. Reserved concurrency to prevent runaway
  api:
    reservedConcurrency: 100  # Adjust per stage

# 4. DynamoDB optimization
custom:
  dynamodb:
    billingMode: PAY_PER_REQUEST  # For unpredictable workloads
    # Or PROVISIONED with autoscaling for predictable

# 5. CloudWatch Logs retention
provider:
  logRetentionInDays:
    dev: 7
    staging: 30
    prod: 90

# 6. X-Ray sampling
# Default: 1 request/second + 5% of additional
# Reduce in dev
custom:
  xraySampling:
    dev: '1'
    prod: '0.05'

# 7. S3 Intelligent Tiering
AssetsBucket:
  Properties:
    IntelligentTieringConfigurations:
      - Id: ArchiveAfter90Days
        Status: Enabled
        Tierings:
          - AccessTier: ARCHIVE_ACCESS
            Days: 90
          - AccessTier: DEEP_ARCHIVE_ACCESS
            Days: 180

# 8. Lambda SnapStart (Java/Python only, not Node.js yet)
# For Node.js: Use provisioned concurrency instead
```

### 11.3 Cost Monitoring

```yaml
# Budget alarm
Resources:
  MonthlyBudget:
    Type: AWS::Budgets::Budget
    Properties:
      Budget:
        BudgetName: ${self:service}-${self:provider.stage}-monthly
        BudgetLimit:
          Amount: ${self:custom.budgetLimit.${self:provider.stage}}
          Unit: USD
        TimeUnit: MONTHLY
        BudgetType: COST
        CostFilters: {}
      NotificationsWithSubscribers:
        - Notification:
            NotificationType: ACTUAL
            ComparisonOperator: GREATER_THAN
            Threshold: 80
            ThresholdType: PERCENTAGE
          Subscribers:
            - SubscriptionType: EMAIL
              Address: ${ssm:/${self:service}/${self:provider.stage}/budget/email}
        - Notification:
            NotificationType: FORECASTED
            ComparisonOperator: GREATER_THAN
            Threshold: 100
            ThresholdType: PERCENTAGE
          Subscribers:
            - SubscriptionType: EMAIL
              Address: ${ssm:/${self:service}/${self:provider.stage}/budget/email}

custom:
  budgetLimit:
    dev: 10
    staging: 100
    prod: 500
```

---

## 12. Migration Strategy

### 12.1 Phased Approach

```
Phase 1: Foundation (Week 1-2)
├── Set up AWS accounts (dev, staging, prod)
├── Configure CI/CD pipeline
├── Implement Serverless Framework project
├── Set up DynamoDB single-table design
├── Implement Cognito + JWT auth
└── Deploy health check endpoint

Phase 2: Core API Migration (Week 3-5)
├── Migrate Users & Auth
├── Migrate Gardens CRUD
├── Migrate Plants CRUD
├── Implement DynamoDB repositories
└── Add integration tests

Phase 3: Complex Features (Week 6-8)
├── Migrate Logs (time-series → DynamoDB)
├── Migrate Inventory
├── Implement DocumentDB for complex queries
├── Set up ElastiCache for sessions
└── Add async processing (SQS + Lambda)

Phase 4: Observability & Hardening (Week 9-10)
├── CloudWatch dashboards & alarms
├── X-Ray tracing
├── Structured logging (EMF)
├── WAF & security headers
├── Load testing
└── Documentation

Phase 5: Cutover (Week 11-12)
├── Blue-green deployment
├── DNS switch (Route53 weighted records)
├── Monitor error rates & latency
├── Rollback plan ready
└── Decommission old infrastructure
```

### 12.2 Data Migration Scripts

```typescript
// scripts/migrate-mongodb-to-dynamodb.ts
import { MongoClient } from 'mongodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { EntityMapper } from '../src/lib/dynamodb/entity-mapper';

async function migrate() {
  const mongo = new MongoClient(process.env.MONGO_URI!);
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
  const tableName = process.env.DYNAMODB_TABLE!;

  await mongo.connect();
  const db = mongo.db('garden-api');

  // Migrate Users
  const users = await db.collection('users').find().toArray();
  await batchWrite(users.map(u => ({
    PutRequest: { Item: EntityMapper.user.toItem(u) },
  })));

  // Migrate Gardens
  const gardens = await db.collection('gardens').find().toArray();
  for (const garden of gardens) {
    const items = [
      { PutRequest: { Item: EntityMapper.garden.toItem(garden, garden.ownerId.toString()) } },
      ...garden.plants.map(p => ({
        PutRequest: { Item: EntityMapper.plant.toItem(p, garden._id.toString()) },
      })),
    ];
    await batchWrite(items);
  }

  // Migrate Logs (batch by garden)
  const logs = await db.collection('logs').find().toArray();
  const logsByGarden = groupBy(logs, l => l.gardenId.toString());
  
  for (const [gardenId, gardenLogs] of Object.entries(logsByGarden)) {
    const items = gardenLogs.map(log => ({
      PutRequest: { Item: EntityMapper.log.toItem(log, gardenId, log.ownerId.toString()) },
    }));
    await batchWrite(items);
  }

  // Migrate Inventory
  const inventory = await db.collection('inventory').find().toArray();
  await batchWrite(inventory.map(i => ({
    PutRequest: { Item: EntityMapper.inventoryItem.toItem(i, i.ownerId.toString()) },
  })));

  // Migrate Refresh Tokens
  const tokens = await db.collection('refreshTokens').find({ revokedAt: null, expiresAt: { $gt: new Date() } }).toArray();
  await batchWrite(tokens.map(t => ({
    PutRequest: { Item: EntityMapper.refreshToken.toItem(t) },
  })));

  console.log('Migration complete!');
}

async function batchWrite(items: any[]) {
  const CHUNK_SIZE = 25; // DynamoDB batch limit
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    await ddb.send(new BatchWriteCommand({
      RequestItems: { [tableName]: chunk },
    }));
  }
}

function groupBy<T>(array: T[], key: (item: T) => string): Record<string, T[]> {
  return array.reduce((acc, item) => {
    const k = key(item);
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

migrate().catch(console.error);
```

### 12.3 Dual-Write Pattern (Zero-Downtime)

```typescript
// During migration, write to both MongoDB and DynamoDB
class DualWriteGardenRepository {
  constructor(
    private mongoRepo: MongoDBGardenRepository,
    private dynamoRepo: DynamoDBGardenRepository,
    private primary: 'mongo' | 'dynamo' = 'mongo'
  ) {}

  async create(garden: Garden, userId: string): Promise<Garden> {
    // Write to primary
    const result = this.primary === 'mongo'
      ? await this.mongoRepo.create(garden, userId)
      : await this.dynamoRepo.create(garden, userId);

    // Async write to secondary (fire and forget)
    this.writeToSecondary(garden, userId).catch(err => 
      console.error('Secondary write failed:', err)
    );

    return result;
  }

  private async writeToSecondary(garden: Garden, userId: string) {
    if (this.primary === 'mongo') {
      await this.dynamoRepo.create(garden, userId);
    } else {
      await this.mongoRepo.create(garden, userId);
    }
  }

  async findById(id: string, userId: string): Promise<Garden | null> {
    // Read from primary
    const result = this.primary === 'mongo'
      ? await this.mongoRepo.findById(id, userId)
      : await this.dynamoRepo.findById(id, userId);

    // If not found, try secondary (for migration period)
    if (!result) {
      return this.primary === 'mongo'
        ? await this.dynamoRepo.findById(id, userId)
        : await this.mongoRepo.findById(id, userId);
    }

    return result;
  }
}
```

---

## 13. Project Structure

```
garden-api-serverless/
├── .github/
│   └── workflows/
│       ├── deploy.yml
│       ├── test.yml
│       └── security.yml
├── infrastructure/
│   ├── vpc.yml                 # VPC, subnets, security groups
│   ├── cognito.yml             # User pools, clients, triggers
│   ├── documentdb.yml          # DocumentDB cluster
│   ├── elasticache.yml         # Redis cluster
│   ├── monitoring.yml          # CloudWatch, X-Ray, alarms
│   ├── s3.yml                  # Buckets, CloudFront
│   └── github-actions-role.yml # OIDC role
├── scripts/
│   ├── migrate-mongodb-to-dynamodb.ts
│   ├── seed-local.ts
│   └── load-test.ts
├── seeds/
│   └── local/
│       ├── users.json
│       ├── gardens.json
│       └── inventory.json
├── src/
│   ├── app.ts                  # Express app (for mono-lambda)
│   ├── lambda.ts               # Lambda entry point
│   ├── lib/
│   │   ├── logger.ts           # Powertools logger
│   │   ├── tracing.ts          # X-Ray helpers
│   │   ├── secrets.ts          # Secrets Manager
│   │   ├── auth/
│   │   │   ├── jwt.ts
│   │   │   └── authorizer.ts
│   │   ├── dynamodb/
│   │   │   ├── entity-mapper.ts
│   │   │   └── client.ts
│   │   └── middleware/
│   │       ├── auth.ts
│   │       ├── validation.ts
│   │       ├── rate-limit.ts
│   │       └── security.ts
│   ├── config/
│   │   └── index.ts            # Environment config
│   ├── repositories/
│   │   ├── dynamodb/
│   │   │   ├── user.repository.ts
│   │   │   ├── garden.repository.ts
│   │   │   ├── plant.repository.ts
│   │   │   ├── log.repository.ts
│   │   │   ├── inventory.repository.ts
│   │   │   └── refreshToken.repository.ts
│   │   └── documentdb/
│   │       └── complex-queries.repository.ts
│   ├── use-cases/
│   │   ├── auth/
│   │   ├── gardens/
│   │   ├── logs/
│   │   └── inventory/
│   ├── handlers/
│   │   ├── api.ts              # Main mono-lambda handler
│   │   ├── auth/
│   │   │   ├── register.ts
│   │   │   ├── login.ts
│   │   │   └── refresh.ts
│   │   ├── gardens/
│   │   ├── logs/
│   │   ├── inventory/
│   │   ├── webhooks/
│   │   └── jobs/
│   ├── triggers/
│   │   └── cognito/
│   └── types/
│       └── index.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── mocks/
├── serverless.yml
├── serverless.dev.yml
├── serverless.staging.yml
├── serverless.prod.yml
├── serverless.local.yml
├── tsconfig.json
├── package.json
├── .eslintrc.js
├── .prettierrc
├── jest.config.ts
└── README.md
```

---

## 14. Implementation Checklist

### 14.1 Pre-requisites
- [ ] AWS accounts (dev, staging, prod) with billing alarms
- [ ] Route53 hosted zone for custom domain
- [ ] ACM certificates for *.garden.com
- [ ] GitHub repository with branch protection
- [ ] Slack/webhook for notifications

### 14.2 Infrastructure Setup
- [ ] VPC with public/private subnets across 2+ AZs
- [ ] Security groups for Lambda, DocumentDB, ElastiCache
- [ ] Cognito User Pool + Client + Domain
- [ ] DocumentDB cluster (if needed)
- [ ] ElastiCache Serverless Redis
- [ ] S3 buckets + CloudFront distributions
- [ ] Parameter Store / Secrets Manager for all secrets
- [ ] IAM roles for Lambda, GitHub Actions

### 14.3 Application Development
- [ ] Serverless Framework project initialized
- [ ] TypeScript + ESBuild + ESLint + Prettier configured
- [ ] DynamoDB single-table design implemented
- [ ] Entity mapper for all domain models
- [ ] Repository layer for DynamoDB
- [ ] Repository layer for DocumentDB (complex queries)
- [ ] Cognito JWT authentication flow
- [ ] Refresh token rotation with DynamoDB TTL
- [ ] API handlers (mono-lambda or split)
- [ ] Input validation (Zod/Yup)
- [ ] Rate limiting (API Gateway + Lambda)
- [ ] Structured logging with Powertools
- [ ] X-Ray tracing instrumentation
- [ ] EMF metrics for business KPIs

### 14.4 Testing
- [ ] Unit tests (>80% coverage)
- [ ] Integration tests against LocalStack
- [ ] Contract tests for API
- [ ] Load testing (k6 or Artillery)
- [ ] Chaos engineering (Lambdas, DynamoDB)

### 14.5 CI/CD
- [ ] GitHub Actions workflow
- [ ] OIDC role for GitHub → AWS
- [ ] Automated testing on PR
- [ ] Staging deployment on merge to main
- [ ] Manual approval for prod
- [ ] Canary deployments for prod
- [ ] Rollback capability

### 14.6 Observability
- [ ] CloudWatch dashboards
- [ ] CloudWatch alarms (errors, latency, throttles)
- [ ] X-Ray service map
- [ ] Log insights queries
- [ ] SNS alerting to Slack/email
- [ ] Budget alarms

### 14.7 Security
- [ ] WAF rules attached
- [ ] Security headers middleware
- [ ] Input sanitization
- [ ] Secrets rotation (automatic)
- [ ] Least-privilege IAM policies
- [ ] VPC endpoints for AWS services
- [ ] Encryption at rest + in transit

### 14.8 Documentation
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Architecture decision records (ADRs)
- [ ] Runbooks for common incidents
- [ ] On-call rotation schedule
- [ ] Cost optimization guide

### 14.9 Migration & Launch
- [ ] Data migration scripts tested
- [ ] Dual-write pattern implemented
- [ ] Load testing passed
- [ ] Blue-green deployment ready
- [ ] DNS cutover plan
- [ ] Rollback plan documented
- [ ] Post-launch monitoring checklist

---

## 📚 Additional Resources

### AWS Documentation
- [Serverless Framework AWS Guide](https://www.serverless.com/framework/docs/providers/aws/)
- [Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [DynamoDB Single Table Design](https://www.amazonaws.cn/en/dynamodb/single-table-design/)
- [HTTP API vs REST API](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html)
- [Lambda Powertools](https://awslabs.github.io/aws-lambda-powertools-typescript/)

### Tools
- [Serverless Dashboard](https://dashboard.serverless.com/) - Monitoring & debugging
- [AWS Lambda Power Tuning](https://github.com/alexcasalboni/aws-lambda-power-tuning) - Right-sizing
- [LocalStack](https://localstack.cloud/) - Local AWS mocking
- [DynamoDB Admin](https://github.com/aaronshaf/dynamodb-admin) - Local DB UI

### Patterns
- [Event-Driven Architecture](https://aws.amazon.com/event-driven-architecture/)
- [Saga Pattern for Distributed Transactions](https://docs.aws.amazon.com/prescriptive-guidance/latest/serverless-microservices/saga.html)
- [Strangler Fig Migration](https://martinfowler.com/bliki/StranglerFigApplication.html)

---

**Document Version**: 1.0  
**Last Updated**: 2026-11-05  
**Author**: Garden Project Team  
**Status**: Ready for Implementation