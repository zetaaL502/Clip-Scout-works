// Updated handleServerExport function in GridPage.tsx

const handleServerExport = () => {
    const exportSegments = clips
        .filter(clip => clip.isVisible)  // Get only visible clips
        .map(clip => buildExportSegment(clip));  // Map to export segments

    // Refactored logic for clarity
    if (exportSegments.length > 0) {
        sendExportRequest(exportSegments);
    } else {
        console.warn('No visible clips available for export.');
    }
};

function buildExportSegment(clip) {
    // Logic to build export segment from clip
    return { 
        id: clip.id,
        name: clip.name,
        // additional properties based on clip
    };
}
