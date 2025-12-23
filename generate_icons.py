#!/usr/bin/env python3
"""
Generate PNG icons for SponsorJumper AI Chrome extension.
Run: python3 generate_icons.py
"""

import struct
import zlib
import os

def create_png(width, height, rgba_data):
    """Create a PNG file from RGBA data."""
    def png_chunk(chunk_type, data):
        chunk_len = struct.pack('>I', len(data))
        chunk_crc = struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)
        return chunk_len + chunk_type + data + chunk_crc

    # PNG signature
    signature = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = png_chunk(b'IHDR', ihdr_data)
    
    # IDAT chunk (image data)
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter byte
        for x in range(width):
            idx = (y * width + x) * 4
            raw_data += rgba_data[idx:idx+4]
    
    compressed = zlib.compress(raw_data, 9)
    idat = png_chunk(b'IDAT', compressed)
    
    # IEND chunk
    iend = png_chunk(b'IEND', b'')
    
    return signature + ihdr + idat + iend

def create_icon(size):
    """Create an icon with skip symbol."""
    # Colors
    bg_color = (26, 26, 46, 255)      # #1a1a2e
    fg_color = (74, 158, 255, 255)    # #4a9eff
    
    # Create RGBA data
    rgba_data = bytearray(size * size * 4)
    
    # Fill background
    for i in range(size * size):
        rgba_data[i*4:i*4+4] = bg_color
    
    # Draw play triangle (pointing right)
    # Triangle from 25% to 65% width, 20% to 80% height
    tri_left = int(size * 0.25)
    tri_right = int(size * 0.60)
    tri_top = int(size * 0.20)
    tri_bottom = int(size * 0.80)
    tri_height = tri_bottom - tri_top
    tri_width = tri_right - tri_left
    
    for y in range(tri_top, tri_bottom):
        # Calculate triangle width at this y
        progress = (y - tri_top) / tri_height
        if progress <= 0.5:
            # Top half - expanding
            row_width = int(tri_width * (progress * 2))
        else:
            # Bottom half - contracting
            row_width = int(tri_width * ((1 - progress) * 2))
        
        for x in range(tri_left, tri_left + row_width):
            if 0 <= x < size and 0 <= y < size:
                idx = (y * size + x) * 4
                rgba_data[idx:idx+4] = fg_color
    
    # Draw vertical bar (skip indicator)
    bar_left = int(size * 0.68)
    bar_right = int(size * 0.80)
    bar_top = int(size * 0.20)
    bar_bottom = int(size * 0.80)
    
    for y in range(bar_top, bar_bottom):
        for x in range(bar_left, bar_right):
            if 0 <= x < size and 0 <= y < size:
                idx = (y * size + x) * 4
                rgba_data[idx:idx+4] = fg_color
    
    return bytes(rgba_data)

def main():
    icons_dir = os.path.dirname(os.path.abspath(__file__))
    icons_path = os.path.join(icons_dir, 'icons')
    
    sizes = [16, 48, 128]
    
    for size in sizes:
        rgba_data = create_icon(size)
        png_data = create_png(size, size, rgba_data)
        
        filepath = os.path.join(icons_path, f'icon{size}.png')
        with open(filepath, 'wb') as f:
            f.write(png_data)
        print(f'Created {filepath}')
    
    print('Done! Icons created successfully.')

if __name__ == '__main__':
    main()
