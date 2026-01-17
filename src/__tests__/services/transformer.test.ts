import { test } from 'node:test';
import assert from 'node:assert';
import { transformToReportAnalysis } from '../../services/transformer';
import { StructuredAnalysisResponse } from '../../services/openai';
import { Document } from '../../types/report';

test('transformToReportAnalysis should transform structured analysis to report analysis', () => {
  const structuredAnalysis: StructuredAnalysisResponse = {
    title: {
      issues: [{ severity: 'critical', description: 'Test issue' }],
      description: 'Test description',
    },
    ownership: {
      issues: [],
    },
    chargesAndMoney: {
      charges: [],
      issues: [],
    },
    covenants: 'Test covenants',
    tenure: 'Test tenure',
    planningAndDevelopment: {
      issues: [],
    },
    completionAndPenaltyRisks: {
      issues: [],
    },
    physicalAndEnvironmentalRisks: {
      issues: [],
    },
    specialConditionsAndAmenities: {
      issues: [],
    },
    propertyDetails: {
      propertyType: 'House',
      bedrooms: 3,
    },
  };

  const documents: Document[] = [
    {
      name: 'test.pdf',
      pages: 10,
      keyFindings: 'Test findings',
    },
  ];

  const result = transformToReportAnalysis(structuredAnalysis, documents);

  assert.strictEqual(result.title.description, 'Test description');
  assert.strictEqual(result.covenants, 'Test covenants');
  assert.strictEqual(result.tenure, 'Test tenure');
  assert.strictEqual(result.documents.length, 1);
  assert.strictEqual(result.documents[0].name, 'test.pdf');
  assert.strictEqual(result.propertyDetails.propertyType, 'House');
  assert.strictEqual(result.propertyDetails.bedrooms, 3);
});

test('transformToReportAnalysis should handle empty strings', () => {
  const structuredAnalysis: StructuredAnalysisResponse = {
    title: {
      issues: [],
      description: '',
    },
    ownership: {
      issues: [],
    },
    chargesAndMoney: {
      charges: [],
      issues: [],
    },
    covenants: '',
    tenure: '',
    planningAndDevelopment: {
      issues: [],
    },
    completionAndPenaltyRisks: {
      issues: [],
    },
    physicalAndEnvironmentalRisks: {
      issues: [],
    },
    specialConditionsAndAmenities: {
      issues: [],
    },
    propertyDetails: {},
  };

  const documents: Document[] = [];

  const result = transformToReportAnalysis(structuredAnalysis, documents);

  assert.strictEqual(result.covenants, '');
  assert.strictEqual(result.tenure, '');
  assert.strictEqual(result.documents.length, 0);
});
