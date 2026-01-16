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

**Response (202 Accepted):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Job queued for processing"
}
```

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

## License

MIT
