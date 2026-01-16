export const STRUCTURED_ANALYSIS_SYSTEM_PROMPT = `You are an expert legal analyst specializing in property legal packs. Analyze the provided legal pack documents and extract structured information. Return a comprehensive analysis in the exact JSON format specified.`;

export const STRUCTURED_ANALYSIS_USER_PROMPT_TEMPLATE = `Analyze the following legal pack documents and extract structured information:

{content}

Return a comprehensive analysis with the following structure:
- title: { issues: array of issues with severity and description, description: summary }
- ownership: { issues: array of ownership-related issues }
- chargesAndMoney: { charges: array of charges with type, amount, description, issues: array of issues }
- covenants: string description
- tenure: string description
- planningAndDevelopment: { issues: array of issues }
- completionAndPenaltyRisks: { issues: array of issues }
- physicalAndEnvironmentalRisks: { issues: array of issues }
- specialConditionsAndAmenities: { issues: array of issues }
- propertyDetails: { propertyType, bedrooms, bathrooms, size, tenure, guidePrice, auctionDate, auctionDateNote }

Each issue should have: severity ('high' | 'medium' | 'low'), description, and optional recommendation.
Each charge should have: type, optional amount, and description.`;

export const KEY_FINDINGS_SYSTEM_PROMPT = `You are an expert legal analyst. Extract the key findings from a legal document. Return only the key findings as plain text, no markdown formatting.`;

export const KEY_FINDINGS_USER_PROMPT_TEMPLATE = `Extract the key findings from the following document: {fileName}

Document content:
{content}

Return only the key findings as plain text, focusing on important legal issues, risks, and notable information.`;
