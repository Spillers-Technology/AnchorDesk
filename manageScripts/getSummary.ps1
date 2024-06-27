# Load the ImportExcel module
Import-Module ImportExcel

# Define function for summarizing notes of a specific ticket
function Get-TicketNoteSummary {
    param(
        [int]$TicketID
    )

    $notes = Get-CWMTicketNote -TicketID $TicketID -all -fields @('dateCreated','createdBy','text')

    $summary = foreach ($note in $notes) {
        $noteTimestamp = [datetime]::Parse($note.dateCreated).ToLocalTime() # Parse and convert to local time
        [PSCustomObject]@{
            Timestamp = $noteTimestamp
            CreatedBy = $note.createdBy
            Note      = $note.text
        }
    }

    return $summary
}

# Get all open tickets for the specified resource
$openTickets = Get-CWMTicket -condition 'Resources="jspillers" and closedFlag = false'

# Initialize an array for the summary sheet
$summarySheet = @()

# Path for the final Excel file
$excelFilePath = "ticketreport.xlsx"

# Define the thresholds
$thresholds = @{
    1 = [TimeSpan]::FromMinutes(30)
    2 = [TimeSpan]::FromHours(24)
    3 = [TimeSpan]::FromDays(3)
    4 = [TimeSpan]::FromDays(7)
}

# Iterate over each open ticket
foreach ($ticket in $openTickets) {
    $dateEntered = [datetime]::Parse($ticket._info.dateEntered).ToLocalTime()
    $lastUpdated = if ($ticket._info.lastUpdated) {
        [datetime]::Parse($ticket._info.lastUpdated).ToLocalTime()
    } else {
        $dateEntered  # Fallback to dateEntered if lastUpdated is null
    }

    # Get notes for the ticket
    $notes = Get-TicketNoteSummary -TicketID $ticket.id

    # Find the last note
    $lastNote = if ($notes) {
        $notes | Sort-Object -Property Timestamp -Descending | Select-Object -First 1
    } else {
        $null
    }

    # Create a custom object for ticket summary
    $ticketSummary = [PSCustomObject]@{
        'Ticket ID'        = $ticket.id
        'Summary'          = $ticket.summary
        'Status'           = $ticket.status.name
        'Owner'            = $ticket.owner.name
        'Priority'         = $ticket.priority.name
        'Created'          = $dateEntered
        'Last Updated'     = $lastUpdated
        'Last Note'        = if ($lastNote) { $lastNote.Timestamp } else { $null }
        'SLA'              = $ticket.sla.name
        'Initial Description' = $ticket.initialDescription
        'SLA Information'  = "$($ticket.slaStatus) - $($ticket.sla.name)"
    }

    # Add the ticket summary to the summary sheet array
    $summarySheet += $ticketSummary

    # Use the ticket ID directly for sheet name
    $sheetName = "T$($ticket.id)x"

    # Export notes to a new sheet in the existing Excel file
    $notes | Export-Excel -Path $excelFilePath -WorksheetName $sheetName -AutoSize -TableName $sheetName -Append -BoldTopRow -FreezeTopRow

    Write-Host "Notes for ticket $($ticket.id) added to sheet $sheetName"
}

# Sort the summary sheet by the 'Last Note' column with the soonest at the top
$sortedSummarySheet = $summarySheet | Sort-Object -Property 'Last Note'

# Export the sorted summary sheet to the Excel file
$sortedSummarySheet | Export-Excel -Path $excelFilePath -WorksheetName 'Summary' -AutoSize -TableName 'Summary' -BoldTopRow -FreezeTopRow -MoveToStart

# Reopen the Excel file for adding conditional formatting
$excelPackage = Open-ExcelPackage -Path $excelFilePath
$workSheet = $excelPackage.Workbook.Worksheets['Summary']

# Apply conditional formatting based on thresholds
$rowIndex = 2 # Assuming headers are on the first row
foreach ($ticket in $sortedSummarySheet) {
    if ($ticket.Priority -match "\d") {
        $priorityNumber = [int]$matches[0]
        if ($thresholds.ContainsKey($priorityNumber)) {
            $threshold = $thresholds[$priorityNumber]
            $timeSinceLastNote = [datetime]::Now - $ticket.'Last Note'
            $cellAddress = "H$rowIndex"  # Assuming 'Last Note' is in column D

            if ($timeSinceLastNote -ge $threshold) {
                # Red background and white text for overdue
                Add-ConditionalFormatting -WorkSheet $workSheet -Address $cellAddress -RuleType Expression -ConditionValue "=TRUE" -ForeGroundColor "White" -BackgroundColor "Red"
            } elseif ($timeSinceLastNote -ge [TimeSpan]::FromTicks($threshold.Ticks * 0.8)) {
                # Yellow background for nearing threshold
                Add-ConditionalFormatting -WorkSheet $workSheet -Address $cellAddress -RuleType Expression -ConditionValue "=TRUE" -BackgroundColor "Yellow"
            }
        }
    }
    $rowIndex++
}

# Save the Excel package
Close-ExcelPackage -ExcelPackage $excelPackage -Show

Write-Host "Summary sheet and notes sheets created and formatted in $excelFilePath"
