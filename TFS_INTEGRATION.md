# TFS Work Item API Integration

## Overview

This document describes the integration of Azure DevOps TFS Work Item API into the Test Recorder application.

## Configuration

### Environment Variables

Add the following to `.env`:

```
# Azure DevOps TFS Work Item API
ADO_TFS_BASE_URL=https://gide-tfs.web.boeing.com/tfs/IT
ADO_TFS_PAT=<your-personal-access-token>
```

**Note:** The `ADO_TFS_PAT` variable is left empty by default. You must add your Azure DevOps Personal Access Token (PAT) to enable the TFS API integration.

## Backend Endpoint

### GET `/api/tfs/workitem/:id`

Fetches detailed information about a TFS work item.

**Parameters:**

- `id` (path parameter): TFS Work Item ID

**Response (Success):**

```json
{
  "success": true,
  "data": {
    "id": 12345,
    "title": "Work Item Title",
    "workItemType": "User Story",
    "state": "Active",
    "assignedTo": "John Doe",
    "createdBy": "Jane Smith",
    "createdDate": "12/18/2024",
    "areaPath": "Project\\Area\\SubArea",
    "iterationPath": "Project\\Sprint 1"
  }
}
```

**Error Response:**

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

## Frontend Integration

### SearchAndAttachPage Component Updates

The `SearchAndAttachPage` component has been enhanced to:

1. **Fetch Work Item Details**: After searching for a story, the component automatically fetches the TFS work item details using the work item ID.

2. **Display Work Item Information**: Shows a detailed panel with:

   - Work Item ID
   - Title
   - Work Item Type
   - State (with color-coded chip)
   - Assigned To (display name)
   - Created By (display name)
   - Created Date (formatted)
   - Area Path
   - Iteration Path

3. **Error Handling**: Gracefully handles missing fields and API errors without breaking the workflow.

4. **Loading States**: Shows loading indicator during API calls.

## Data Flow

1. User enters a story number in the Search ADO Story section
2. Application fetches story from cloud Azure DevOps (if ADO_ORG, ADO_PROJECT, ADO_TOKEN are configured)
3. If TFS API is configured (ADO_TFS_PAT is set), the application also fetches work item details from the TFS endpoint
4. Work item details are displayed in a formatted panel
5. User selects test cases and attaches them to the story

## Field Mapping

The API response fields are mapped as follows:

| TFS Field                     | Display Label  | Description                               |
| ----------------------------- | -------------- | ----------------------------------------- |
| id                            | ID             | Work Item identifier                      |
| System.Title                  | Title          | Work item title/summary                   |
| System.WorkItemType           | Type           | Type of work item (User Story, Bug, etc.) |
| System.State                  | State          | Current state (Active, Closed, etc.)      |
| System.AssignedTo.displayName | Assigned To    | Person assigned to the work item          |
| System.CreatedBy.displayName  | Created By     | Person who created the work item          |
| System.CreatedDate            | Created Date   | Date of creation (formatted)              |
| System.AreaPath               | Area Path      | Organizational area path                  |
| System.IterationPath          | Iteration Path | Sprint/iteration path                     |

## Error Handling

The integration includes comprehensive error handling:

- **Missing Configuration**: If `ADO_TFS_BASE_URL` or `ADO_TFS_PAT` are not set, the endpoint returns a 400 error.
- **Invalid Work Item ID**: If the work item doesn't exist, the API returns an error.
- **Network Errors**: Connection issues are caught and returned with descriptive messages.
- **Missing Fields**: Fields that don't exist in the API response are replaced with default values (empty strings or "N/A").
- **Graceful Degradation**: If the TFS API fails, the search flow continues without the work item details panel.

## Authentication

The integration uses **Basic Authentication** with:

- **Username**: "PAT"
- **Password**: Azure DevOps Personal Access Token from `ADO_TFS_PAT` environment variable

## Testing

To test the integration:

1. Set `ADO_TFS_PAT` in `.env` with a valid Azure DevOps PAT
2. Ensure `ADO_TFS_BASE_URL` is correctly set
3. Navigate to "Search & Attach Tests to ADO Story" on the landing page
4. Enter a valid work item ID (must exist in your TFS instance)
5. Click "Search Story"
6. The work item details should appear in the panel below

## Security Considerations

- **PAT Protection**: The Personal Access Token should never be committed to version control. It's configured via `.env` file which is in `.gitignore`.
- **Token Scope**: Create PATs with minimal required permissions (Work Item Read).
- **Network Security**: Use HTTPS for all API calls (already enforced by the TFS endpoint URL).
