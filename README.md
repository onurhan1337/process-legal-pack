# Legal Pack Processor

Backend service for processing legal pack PDFs with OpenAI analysis and Firecrawl URL extraction.

## Features

- PDF text extraction from legal pack documents
- Structured analysis using OpenAI GPT-4o-mini
- Property details extraction from URLs using Firecrawl
- Key findings generation per document
- Async job processing with status tracking
- Webhook callbacks to Supabase

## Prerequisites

- Node.js >= 20.0.0
- Supabase project with storage bucket for PDFs
- OpenAI API key
- Firecrawl API key (optional)

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```

4. Build the project:
   ```bash
   npm run build
   ```

5. Start the server:
   ```bash
   npm start
   ```

   Or for development:
   ```bash
   npm run dev
   ```

## Environment Variables

See `.env.example` for all required environment variables.

## API Endpoints

### Health Check
```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "legal-pack-processor"
}
```

### Process Legal Pack
```
POST /process
Authorization: Bearer <supabase-jwt-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "reportId": "123e4567-e89b-12d3-a456-426614174000",
  "userId": "user-uuid",
  "url": "https://example.com/property-listing"
}
```

**Note:** `userId` is optional - if not provided, it will be extracted from the JWT token. `url` is also optional.

**Response (202 Accepted):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Job queued for processing"
}
```

## Frontend Integration (React)

### Example: Calling the API from React

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function processLegalPack(reportId: string, url?: string) {
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    throw new Error('Not authenticated');
  }

  const response = await fetch('https://your-backend-url.com/process', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      reportId,
      userId: session.user.id,
      url,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start processing');
  }

  const result = await response.json();
  return result;
}
```

### Important Security Notes

- **Never expose `WEBHOOK_SECRET` to the frontend** - It's only used server-to-server (optional, only needed if webhooks are configured)
- The frontend only needs:
  - Supabase JWT token (from `session.access_token`)
  - `reportId` (required)
  - `userId` (optional, extracted from JWT if not provided)
  - `url` (optional)
- The backend automatically includes `webhookSecret` in webhook payloads if configured (webhooks are optional)

### Get Job Status
```
GET /jobs/:jobId
```

**Response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "reportId": "123e4567-e89b-12d3-a456-426614174000",
  "userId": "user-uuid",
  "url": "https://example.com/property-listing",
  "status": "completed",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:05:00.000Z"
}
```

## Processing Flow

1. Client sends POST request to `/process` with `reportId`, `userId`, and optional `url`
2. Server validates JWT token and creates a background job
3. Job processor:
   - Downloads PDFs from Supabase Storage
   - Extracts text from PDFs using pdfjs-dist
   - Optionally scrapes URL using Firecrawl for property details
   - Generates structured analysis using OpenAI
   - Generates key findings for each document
   - Updates Supabase via webhook with analysis results

## Output Example

The service updates the Supabase `reports` table with `analysis_result` JSONB containing:

```json
{
  "title": {
    "issues": [
      {
        "severity": "high",
        "description": "Title defect identified",
        "recommendation": "Obtain updated title documents"
      }
    ],
    "description": "Property title analysis summary"
  },
  "ownership": {
    "issues": []
  },
  "chargesAndMoney": {
    "charges": [
      {
        "type": "Mortgage",
        "amount": 150000,
        "description": "Outstanding mortgage charge"
      }
    ],
    "issues": []
  },
  "covenants": "Standard restrictive covenants apply",
  "tenure": "Freehold",
  "planningAndDevelopment": {
    "issues": []
  },
  "completionAndPenaltyRisks": {
    "issues": []
  },
  "physicalAndEnvironmentalRisks": {
    "issues": []
  },
  "specialConditionsAndAmenities": {
    "issues": []
  },
  "documents": [
    {
      "name": "title-deed.pdf",
      "pages": 5,
      "keyFindings": "Property is freehold with no restrictions"
    }
  ],
  "propertyDetails": {
    "propertyType": "House",
    "bedrooms": 3,
    "bathrooms": 2,
    "size": "1200 sq ft",
    "tenure": "Freehold",
    "guidePrice": "£250,000",
    "auctionDate": "2024-02-15",
    "auctionDateNote": "Auction scheduled for February 15th"
  }
}
```

## Development

Run type checking:
```bash
npm run type-check
```

Run tests:
```bash
npm test
```

## Deployment

The service is configured for deployment on Render. See `render.yaml` for configuration.

### Render Deployment Setup

1. **Using render.yaml (Recommended):**
   - Connect your GitHub repository to Render
   - Render will automatically detect and use `render.yaml`
   - Ensure the build command is: `npm ci && npm run build`
   - Ensure the start command is: `npm start`

2. **Manual Configuration (if render.yaml isn't detected):**
   - Go to your Render dashboard
   - Navigate to your service settings
   - Set the following:
     - **Build Command:** `npm ci && npm run build`
     - **Start Command:** `npm start`
     - **Node Version:** 20.x or higher
   - Make sure to set all required environment variables listed in `render.yaml`

**Important:** The build command must include `npm run build` to compile TypeScript. If you see errors about missing `dist/index.js`, it means the build step didn't run.

## License

MIT
