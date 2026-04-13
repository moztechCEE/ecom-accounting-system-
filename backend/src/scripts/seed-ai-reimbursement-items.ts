import { PrismaClient } from '@prisma/client';
import { AI_AGENT_CORE_PRINCIPLES } from '../modules/ai/ai-principles';

// Note: Ensure GEMINI_API_KEY is set in your environment variables
// or run with: export GEMINI_API_KEY=your_key && npm run seed:ai-items

const prisma = new PrismaClient();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ENTITY_ID = 'tw-entity-001'; // Default to Taiwan entity

async function main() {
  if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY is not set in environment variables.');
    process.exit(1);
  }

  console.log('🤖 Starting AI-powered Reimbursement Item seeding...');

  // 1. Fetch all active expense accounts
  const accounts = await prisma.account.findMany({
    where: {
      entityId: ENTITY_ID,
      isActive: true,
      // Usually expense accounts start with 5, 6, or are of type EXPENSE
      // But let's just get all and let AI decide, or filter by code/type if possible.
      // Assuming standard chart of accounts, expenses are usually 5xxx, 6xxx, 7xxx, 8xxx
      OR: [
        { code: { startsWith: '5' } },
        { code: { startsWith: '6' } },
        { code: { startsWith: '7' } },
        { code: { startsWith: '8' } },
      ],
    },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
    },
  });

  if (accounts.length === 0) {
    console.error('❌ No expense accounts found. Please seed accounts first.');
    process.exit(1);
  }

  console.log(`📚 Found ${accounts.length} expense accounts.`);

  // 2. Prepare prompt for Gemini
  const accountListText = accounts
    .map((a) => `- ${a.code} ${a.name} (${a.description || ''}) [ID: ${a.id}]`)
    .join('\n');

  const prompt = `
${AI_AGENT_CORE_PRINCIPLES}

Role:
You are an accountant setting up reimbursement master data for a Taiwanese e-commerce company.

Task:
Generate a practical list of reimbursement items that employees can easily understand and choose from.
Cover common scenarios like travel, office supplies, marketing, software, meals, and logistics.
Less is more: avoid duplicate, overlapping, or overly specific items.

Based on the provided list of Accounting Accounts, generate 30-50 common Reimbursement Items.

For each item, provide:
1. "name": User-friendly name (e.g., "計程車費", "文具用品", "Facebook 廣告費").
2. "description": A helpful tooltip description for the user.
3. "keywords": A list of 3-5 keywords for search/AI matching.
4. "accountId": The exact ID of the corresponding account from the provided list.
5. "defaultReceiptType": One of ["TAX_INVOICE", "RECEIPT", "BANK_SLIP", "INTERNAL_ONLY"].
6. "allowedReceiptTypes": A comma-separated string of allowed types (e.g., "TAX_INVOICE,RECEIPT").

Available Accounts:
${accountListText}

Return the result as a raw JSON array of objects only.
Do not include markdown or explanation.
`;

  console.log('🧠 Asking Gemini to generate reimbursement items...');

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Gemini API Error: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('Empty response from Gemini');
    }

    // Clean up markdown code blocks if present
    const jsonString = text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    const items = JSON.parse(jsonString);

    console.log(
      `✨ AI generated ${items.length} items. Inserting into database...`,
    );

    let createdCount = 0;
    for (const item of items) {
      // Verify account exists (double check)
      const accountExists = accounts.find((a) => a.id === item.accountId);
      if (!accountExists) {
        console.warn(
          `⚠️ Account ID ${item.accountId} not found for item ${item.name}. Skipping.`,
        );
        continue;
      }

      // Check if item with same name already exists to avoid duplicates
      const existingItem = await prisma.reimbursementItem.findFirst({
        where: {
          entityId: ENTITY_ID,
          name: item.name,
        },
      });

      if (existingItem) {
        console.log(`ℹ️ Item "${item.name}" already exists. Skipping.`);
        continue;
      }

      await prisma.reimbursementItem.create({
        data: {
          entityId: ENTITY_ID,
          name: item.name,
          description: item.description,
          accountId: item.accountId,
          keywords: item.keywords ? item.keywords.join(',') : null,
          defaultReceiptType: item.defaultReceiptType,
          allowedReceiptTypes: item.allowedReceiptTypes,
          isActive: true,
        },
      });
      createdCount++;
    }

    console.log(`✅ Successfully created ${createdCount} reimbursement items.`);
  } catch (error) {
    console.error('❌ Error during AI generation or insertion:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
