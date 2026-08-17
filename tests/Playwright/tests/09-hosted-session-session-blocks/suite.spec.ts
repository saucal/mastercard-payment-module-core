import { test } from '../../fixtures/test';
import { describeSessionValidationCases } from '../_shared/session-validation-cases';

// Identical in coverage to suite 08 (classic) — see the shared module.
test.describe.serial('Hosted Session - Session Loading & Validation (Blocks)', () => {
  describeSessionValidationCases('blocks');
});
