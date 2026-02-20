import { beforeEach, describe, expect, it } from 'vitest';

import { FormDetector } from '../FormDetector';
import { DetectedFieldType } from '../types/FormFields';

import { createTestDom } from './TestUtils';

describe('FormDetector - Microsoft Entra ID 2FA', () => {
  const htmlFile = 'entra-id-2fa.html';
  let document: Document;
  let formDetector: FormDetector;

  beforeEach(() => {
    const dom = createTestDom(htmlFile);
    document = dom.window.document;
  });

  describe('TOTP field detection', () => {
    it('should detect the 2FA code input field as TOTP', () => {
      const totpInput = document.getElementById('idTxtBx_SAOTCC_OTC') as HTMLInputElement;
      expect(totpInput).toBeTruthy();

      formDetector = new FormDetector(document, totpInput);

      const detectedType = formDetector.getDetectedFieldType();
      expect(detectedType).toBe(DetectedFieldType.Totp);
    });

    it('should find the TOTP field when searching from form', () => {
      formDetector = new FormDetector(document, document.body);

      const totpField = formDetector.findTotpField();
      expect(totpField).toBeTruthy();
      expect(totpField?.id).toBe('idTxtBx_SAOTCC_OTC');
    });

    it('should detect TOTP field with maxlength=6', () => {
      const totpInput = document.getElementById('idTxtBx_SAOTCC_OTC') as HTMLInputElement;
      expect(totpInput.maxLength).toBe(6);
      expect(totpInput.type).toBe('tel');
    });

    it('should recognize form contains login fields for TOTP', () => {
      formDetector = new FormDetector(document, document.body);

      const containsLogin = formDetector.containsLoginForm();
      expect(containsLogin).toBe(true);
    });
  });

  describe('Form structure', () => {
    it('should find hidden mfaAuthMethod input', () => {
      const mfaMethod = document.querySelector('input[name="mfaAuthMethod"]') as HTMLInputElement;
      expect(mfaMethod).toBeTruthy();
      expect(mfaMethod.value).toBe('PhoneAppOTP');
    });

    it('should find the submit button', () => {
      const submitBtn = document.getElementById('idSubmit_SAOTCC_Continue') as HTMLInputElement;
      expect(submitBtn).toBeTruthy();
      expect(submitBtn.type).toBe('submit');
      expect(submitBtn.value).toBe('Verify');
    });

    it('should detect aria-label for accessibility', () => {
      const totpInput = document.getElementById('idTxtBx_SAOTCC_OTC') as HTMLInputElement;
      expect(totpInput.getAttribute('aria-label')).toBe('Code');
    });
  });

  describe('TOTP field attributes', () => {
    it('should have autocomplete disabled', () => {
      const totpInput = document.getElementById('idTxtBx_SAOTCC_OTC') as HTMLInputElement;
      expect(totpInput.autocomplete).toBe('off');
    });

    it('should be marked as required', () => {
      const totpInput = document.getElementById('idTxtBx_SAOTCC_OTC') as HTMLInputElement;
      expect(totpInput.getAttribute('aria-required')).toBe('true');
    });

    it('should have proper ARIA descriptions', () => {
      const totpInput = document.getElementById('idTxtBx_SAOTCC_OTC') as HTMLInputElement;
      const describedBy = totpInput.getAttribute('aria-describedby');
      expect(describedBy).toContain('idDiv_SAOTCC_Description');
    });
  });
});
