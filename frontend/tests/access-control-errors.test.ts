import assert from 'node:assert/strict'
import test from 'node:test'
import { getAccessControlErrorMessage } from '../src/utils/access-control-errors'

test('explains duplicate email without suggesting a duplicate account', () => {
  assert.equal(getAccessControlErrorMessage({ response: { status: 409, data: { message: 'Email test@example.com already exists' } } }), '此電子郵件已有帳號，請至使用者清單查詢或編輯原帳號。')
})

test('does not mislabel other conflicts as an existing email', () => {
  assert.equal(getAccessControlErrorMessage({ response: { status: 409, data: { message: 'Duplicate value detected' } } }), '資料與現有紀錄重複，請確認電子郵件及帳號資料後再試。')
})

test('preserves validation details instead of the generic HTTP 400 message', () => {
  assert.equal(getAccessControlErrorMessage({ response: { status: 400, data: { message: ['password must be longer than or equal to 8 characters', 'email must be an email'] } }, message: 'Request failed with status code 400' }), 'password must be longer than or equal to 8 characters；email must be an email')
})

test('handles server, transport, and unknown failures', () => {
  assert.equal(getAccessControlErrorMessage({ response: { data: { message: 'Forbidden' } } }), 'Forbidden')
  assert.equal(getAccessControlErrorMessage(new Error('Network Error')), 'Network Error')
  assert.equal(getAccessControlErrorMessage(null), '操作失敗，請稍後再試')
})
