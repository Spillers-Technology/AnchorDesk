# Load the ConnectWise Manage PowerShell Module
Import-Module ConnectWiseManageAPI

# Get Unassigned Tickets from Team 1
$conditions = 'status/name = "New" AND team/name contains "1" AND closedFlag = false AND summary not contains "Wellness"'

# Get tickets based on the conditions
$ticketsToUpdate = Get-CWMTicket -condition $conditions -All

# Function to get company acronym
function Get-CompanyAcronym {
    param (
        [int]$companyId
    )

    $company = Get-CWMCompany -id $companyId

    # Assuming the acronym is in customFields with caption 'Acronym:'
    $acronymField = $company.customFields | Where-Object { $_.caption -eq 'Acronym:' }

    return $acronymField.value
}

# Function to extract ticket reason from existing title
function Get-TicketReason {
    param (
        [string]$title
    )

    # Split the title by separators
    $separators = '-,|'
    $parts = $title -split "[$separators]"

    # Get the last part that is at least 3 characters long, or "New Ticket" if none
    foreach ($part in [System.Linq.Enumerable]::Reverse($parts)) {
        if ($part.Trim().Length -ge 3) {
            return $part.Trim()
        }
    }

    return "New Ticket"
}

# Update Ticket Titles
foreach ($ticket in $ticketsToUpdate) {
    # Get company details
    $companyId = $ticket.company.id
    $companyAcronym = Get-CompanyAcronym -companyId $companyId

    # Extract contact name and ticket reason
    $contactName = $ticket.contact.name
    $ticketReason = Get-TicketReason -title $ticket.summary

    # Construct New Title
    $newTitle = "$companyAcronym - $contactName - $ticketReason"

    # Prepare Update Parameters for title
    $updateParamsTitle = @{
        ID = $ticket.id
        Operation = 'replace'
        Path = 'summary'
        Value = $newTitle
    }

    # Update the ticket title
    #Update-CWMTicket @updateParamsTitle

    # Prepare Update Parameters for status
    $updateParamsStatus = @{
        ID = $ticket.id
        Operation = 'replace'
        Path = 'status'
        Value = 'reviewed'
    }

    # Update the ticket status
    #Update-CWMTicket @updateParamsStatus
    Write-Host "Updated ticket $($ticket.id) title to '$newTitle' and status to 'reviewed'"
}
