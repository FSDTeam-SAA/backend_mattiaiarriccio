import { apiCatalog } from '../docs/apiCatalog.js';
import { sendSuccess } from '../utils/response.js';

const renderHtml = () => {
  const groupsHtml = apiCatalog.groups
    .map(
      (group) => `
        <section>
          <h2>${group.name}</h2>
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              ${group.routes
                .map(
                  (route) => `
                    <tr>
                      <td><code>${route.method}</code></td>
                      <td><code>${apiCatalog.basePath}${route.path}</code></td>
                      <td>${route.description}</td>
                    </tr>
                  `
                )
                .join('')}
            </tbody>
          </table>
        </section>
      `
    )
    .join('');

  const notesHtml = apiCatalog.notes.map((note) => `<li>${note}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${apiCatalog.title}</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 32px;
        background: #f7f8fb;
        color: #1f2937;
      }
      .container {
        max-width: 1100px;
        margin: 0 auto;
      }
      h1, h2 {
        margin-bottom: 12px;
      }
      .card {
        background: white;
        padding: 20px 24px;
        border-radius: 12px;
        margin-bottom: 20px;
        box-shadow: 0 8px 30px rgba(15, 23, 42, 0.08);
      }
      code {
        background: #f1f5f9;
        padding: 2px 6px;
        border-radius: 6px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        text-align: left;
        padding: 12px;
        border-bottom: 1px solid #e5e7eb;
        vertical-align: top;
      }
      th {
        background: #f8fafc;
      }
      ul {
        margin: 0;
        padding-left: 20px;
      }
      a {
        color: #b91c1c;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <h1>${apiCatalog.title}</h1>
        <p>Version ${apiCatalog.version}</p>
        <p>Base path: <code>${apiCatalog.basePath}</code></p>
        <p>AI source: <a href="${apiCatalog.aiService.docsUrl}" target="_blank" rel="noreferrer">${apiCatalog.aiService.docsUrl}</a></p>
      </div>
      <div class="card">
        <h2>Sample Accounts</h2>
        <p>User: <code>${apiCatalog.sampleAccounts.user.email}</code> / <code>${apiCatalog.sampleAccounts.user.password}</code></p>
        <p>Admin: <code>${apiCatalog.sampleAccounts.admin.email}</code> / <code>${apiCatalog.sampleAccounts.admin.password}</code></p>
      </div>
      <div class="card">
        <h2>Integration Notes</h2>
        <ul>${notesHtml}</ul>
      </div>
      <div class="card">
        ${groupsHtml}
      </div>
    </div>
  </body>
</html>`;
};

export const renderDocsPage = (req, res) => {
  res.status(200).type('html').send(renderHtml());
};

export const getDocsJson = (req, res) =>
  sendSuccess(res, {
    message: 'API catalog fetched successfully',
    data: apiCatalog
  });
