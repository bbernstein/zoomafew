type LayoutDescription = {
    area: number;
    cols: number;
    rows: number;
    width: number;
    height: number;
}

type CropValues = {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

type RectValues = {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Calculate optimal layout (most area used) of a number of boxes within a larger frame.
 * Given number of boxes, aspectRatio of those boxes, and spacing between them.
 *
 * Thanks to Anton Dosov for algorithm shown in this article:
 * https://dev.to/antondosov/building-a-video-gallery-just-like-in-zoom-4mam
 *
 * @param frameWidth width of the space holding the boxes
 * @param frameHeight height of the space holding the boxes
 * @param boxCount number of boxes to place (all same aspect ratio)
 * @param aspectRatio ratio of width to height of the boxes (usually 16/9)
 * @param spacing amount of space (margin) between boxes to spread them out
 * @returns A description of the optimal layout
 */
function calcOptimalBoxes(frameWidth: number,
                          frameHeight: number,
                          boxCount: number,
                          aspectRatio: number,
                          spacing: number): LayoutDescription {

    let bestLayout: LayoutDescription = {
        area: 0,
        cols: 0,
        rows: 0,
        width: 0,
        height: 0
    }

    // try each possible number of columns to find the one with the highest area (optimum use of space)
    for (let cols = 1; cols <= boxCount; cols++) {
        const rows = Math.ceil(boxCount / cols);
        // pack the frames together by removing the spacing between them
        const packedWidth = frameWidth - (spacing * (cols - 1));
        const packedHeight = frameHeight - (spacing * (rows - 1));
        const hScale = packedWidth / (cols * aspectRatio);
        const vScale = packedHeight / rows;
        let width;
        let height;
        if (hScale <= vScale) {
            width = Math.floor(packedWidth / cols / 16) * 16;
            height = Math.floor(width / aspectRatio / 18) * 18;
        } else {
            height = Math.floor(packedHeight / rows / 18 ) * 18;
            width = Math.floor(height * aspectRatio / 16 ) * 16;
        }
        const area = width * height;
        if (area > bestLayout.area) {
            bestLayout = { area, width, height, rows, cols };
        }
    }
    return bestLayout;
}

/**
 * Calculate crop values for the gallery boxes given the overall frame size and number of boxes in the gallary
 *
 * @param sourceWidth Width of the enclosing frame
 * @param sourceHeight Height of the enclosing frame
 * @param itemCount Number of boxes to lay out
 * @returns an array of crop values for a bunch of zoom boxes
 */
export function autoCropZoomGallery(sourceWidth: number, sourceHeight: number, itemCount: number): CropValues[] {

    // hardcoding a bunch of values that seem to work for me
    const topMargin = 94;
    const bottomMargin = 122;
    const leftMargin = 26;
    const rightMargin = 26;
    const spacing = 12;
    const aspectRatio = 16 / 9;

    let centerV = (sourceHeight - topMargin - bottomMargin) / 2 + topMargin;

    // width excluding margins
    const innerWidth = sourceWidth - leftMargin - rightMargin;
    const innerHeight = sourceHeight - topMargin - bottomMargin;

    let bestLayout: LayoutDescription;

    // special case for 1 item
    if (itemCount === 1) {
        // when only one item, extra margins and center on source center, without margins considered
        // TODO I don't know if 140 works universally, it's probably relative to screen size... may need work
        const width1 = sourceWidth - (leftMargin + rightMargin + 140);
        centerV = sourceHeight / 2;
        bestLayout = {
            area: 0,
            cols: 1,
            rows: 1,
            width: width1,
            height: width1 / aspectRatio
        }
    } else {
        bestLayout = calcOptimalBoxes(innerWidth, innerHeight, itemCount, aspectRatio, spacing);
    }

    const numCols = bestLayout.cols;
    const numRows = bestLayout.rows;
    const boxWidth = bestLayout.width;
    const boxHeight = bestLayout.height;

    // last row might not be full
    const lastRow = numRows - 1;
    const lastRowCols = numCols - (numRows * numCols - itemCount);

    const result: CropValues[] = [];

    // figure out crop for each item
    for (let i=0; i < itemCount; i++) {
        const colInd = i % numCols;
        const rowInd = Math.floor(i / numCols);
        const rowSize = (rowInd === lastRow) ? lastRowCols : numCols;

        const boxWidthSum = rowSize * boxWidth + (spacing * (rowSize - 1))
        const boxHeightSum = numRows * boxHeight + (spacing * (numRows - 1))

        const hMargin = (sourceWidth - boxWidthSum) / 2;

        const cropLeft = hMargin + (colInd * boxWidth) + (colInd * spacing);
        const cropRight = sourceWidth - (cropLeft + boxWidth);

        // KLUDGE for some reason, after a certain amount, it pushes everything down 1 pixel.
        // I don't know if this is based on number of items or rows or columns. I think it's when a
        // third column is added. For now I do it after at the 7th item, but probably not right
        // TODO work out when this is needed or if there's a cleaner workaround
        const pushDownKludge = itemCount >= 7 ? 1 : 0;

        const cropTop = (centerV - boxHeightSum / 2) + (rowInd * (boxHeight + spacing)) + pushDownKludge;
        const cropBottom = sourceHeight - (cropTop + boxHeight);

        result.push({ left: cropLeft, right: cropRight, top: cropTop, bottom: cropBottom});
    }

    return result;
}

export function convertCropsToRect(frameWidth: number, frameHeight: number, crops: CropValues[]): RectValues[] {
    return crops.map(crop => ({
        x: crop.left,
        y: crop.top,
        width: (frameWidth - crop.right) - crop.left,
        height: (frameHeight - crop.bottom) - crop.top
    }));
}
