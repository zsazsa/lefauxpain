package storage

import (
	"encoding/binary"
	"io"
	"os"
	"path/filepath"
)

// GetAudioDuration returns the duration in seconds for an audio file.
// Supports MP3, WAV, OGG (Vorbis/Opus), FLAC, and M4A/AAC/MP4 natively.
// Returns 0 for unsupported formats or on parse error.
func (fs *FileStore) GetAudioDuration(relPath, mimeType string) float64 {
	absPath := filepath.Join(fs.DataDir, relPath)
	f, err := os.Open(absPath)
	if err != nil {
		return 0
	}
	defer f.Close()

	switch mimeType {
	case "audio/mpeg":
		return mp3Duration(f)
	case "audio/wav":
		return wavDuration(f)
	case "audio/ogg":
		return oggDuration(f)
	case "audio/flac":
		return flacDuration(f)
	case "audio/mp4", "audio/x-m4a", "audio/aac":
		return mp4Duration(f)
	default:
		return 0
	}
}

// wavDuration parses a WAV RIFF header to compute duration.
func wavDuration(r io.ReadSeeker) float64 {
	// Standard WAV header is 44 bytes minimum
	var header [44]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return 0
	}

	// Verify RIFF header
	if string(header[0:4]) != "RIFF" || string(header[8:12]) != "WAVE" {
		return 0
	}

	numChannels := int(binary.LittleEndian.Uint16(header[22:24]))
	sampleRate := int(binary.LittleEndian.Uint32(header[24:28]))
	bitsPerSample := int(binary.LittleEndian.Uint16(header[34:36]))

	if numChannels == 0 || sampleRate == 0 || bitsPerSample == 0 {
		return 0
	}

	// Find the "data" chunk — it's usually at offset 36, but not always
	r.Seek(12, io.SeekStart) // after "RIFF" + size + "WAVE"
	var chunkHeader [8]byte
	for {
		if _, err := io.ReadFull(r, chunkHeader[:]); err != nil {
			return 0
		}
		chunkID := string(chunkHeader[0:4])
		chunkSize := binary.LittleEndian.Uint32(chunkHeader[4:8])

		if chunkID == "data" {
			bytesPerSample := numChannels * bitsPerSample / 8
			if bytesPerSample == 0 {
				return 0
			}
			totalSamples := int(chunkSize) / bytesPerSample
			return float64(totalSamples) / float64(sampleRate)
		}

		// Skip to next chunk
		if _, err := r.Seek(int64(chunkSize), io.SeekCurrent); err != nil {
			return 0
		}
	}
}

// mp3Duration estimates MP3 duration by parsing frame headers.
// Handles both CBR and VBR (via Xing header or frame scanning).
func mp3Duration(r io.ReadSeeker) float64 {
	fileSize, err := r.Seek(0, io.SeekEnd)
	if err != nil || fileSize == 0 {
		return 0
	}
	r.Seek(0, io.SeekStart)

	// Skip ID3v2 tag if present
	audioStart := int64(0)
	var id3Header [10]byte
	if _, err := io.ReadFull(r, id3Header[:]); err != nil {
		return 0
	}
	if string(id3Header[0:3]) == "ID3" {
		// Synchsafe integer: 4 bytes, 7 bits each
		tagSize := int64(id3Header[6])<<21 | int64(id3Header[7])<<14 |
			int64(id3Header[8])<<7 | int64(id3Header[9])
		audioStart = tagSize + 10
	}
	r.Seek(audioStart, io.SeekStart)

	// Find first valid MP3 frame sync
	frame, offset := findFrameSync(r, audioStart)
	if frame == nil {
		return 0
	}

	bitrate := frame.bitrate
	sampleRate := frame.sampleRate
	samplesPerFrame := frame.samplesPerFrame

	if bitrate == 0 || sampleRate == 0 {
		return 0
	}

	// Check for Xing/VBRI VBR header in the first frame
	if totalFrames := findXingFrames(r, offset, frame); totalFrames > 0 {
		return float64(totalFrames) * float64(samplesPerFrame) / float64(sampleRate)
	}

	// CBR estimate: audio_data_bytes * 8 / (bitrate_bps)
	audioBytes := fileSize - audioStart
	return float64(audioBytes) * 8.0 / float64(bitrate*1000)
}

type mp3Frame struct {
	version         int // 1=MPEG1, 2=MPEG2, 3=MPEG2.5
	layer           int // 1, 2, or 3
	bitrate         int // kbps
	sampleRate      int // Hz
	samplesPerFrame int
	frameSize       int
}

var mp3Bitrates = [5][16]int{
	// MPEG1 Layer 1
	{0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0},
	// MPEG1 Layer 2
	{0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0},
	// MPEG1 Layer 3
	{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0},
	// MPEG2/2.5 Layer 1
	{0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0},
	// MPEG2/2.5 Layer 2,3
	{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},
}

var mp3SampleRates = [3][4]int{
	{44100, 48000, 32000, 0}, // MPEG1
	{22050, 24000, 16000, 0}, // MPEG2
	{11025, 12000, 8000, 0},  // MPEG2.5
}

func parseFrameHeader(h uint32) *mp3Frame {
	// Check sync: 11 bits of 1s
	if h>>21 != 0x7FF {
		return nil
	}

	versionBits := (h >> 19) & 3
	layerBits := (h >> 17) & 3
	bitrateIdx := (h >> 12) & 0xF
	srIdx := (h >> 10) & 3
	padding := (h >> 9) & 1

	if versionBits == 1 || layerBits == 0 || bitrateIdx == 0 || bitrateIdx == 15 || srIdx == 3 {
		return nil
	}

	var version, vIdx int
	switch versionBits {
	case 3:
		version = 1
		vIdx = 0
	case 2:
		version = 2
		vIdx = 1
	case 0:
		version = 3
		vIdx = 2
	}

	var layer int
	switch layerBits {
	case 3:
		layer = 1
	case 2:
		layer = 2
	case 1:
		layer = 3
	}

	// Bitrate table index
	var brIdx int
	if version == 1 {
		brIdx = layer - 1 // 0, 1, 2
	} else {
		if layer == 1 {
			brIdx = 3
		} else {
			brIdx = 4
		}
	}

	bitrate := mp3Bitrates[brIdx][bitrateIdx]
	sampleRate := mp3SampleRates[vIdx][srIdx]

	if bitrate == 0 || sampleRate == 0 {
		return nil
	}

	var samplesPerFrame int
	var frameSize int
	if layer == 1 {
		samplesPerFrame = 384
		frameSize = (12*bitrate*1000/sampleRate + int(padding)) * 4
	} else if layer == 2 {
		samplesPerFrame = 1152
		frameSize = 144*bitrate*1000/sampleRate + int(padding)
	} else { // layer 3
		if version == 1 {
			samplesPerFrame = 1152
			frameSize = 144*bitrate*1000/sampleRate + int(padding)
		} else {
			samplesPerFrame = 576
			frameSize = 72*bitrate*1000/sampleRate + int(padding)
		}
	}

	return &mp3Frame{
		version:         version,
		layer:           layer,
		bitrate:         bitrate,
		sampleRate:      sampleRate,
		samplesPerFrame: samplesPerFrame,
		frameSize:       frameSize,
	}
}

func findFrameSync(r io.ReadSeeker, startOffset int64) (*mp3Frame, int64) {
	buf := make([]byte, 4)
	maxSearch := int64(64 * 1024) // search first 64KB

	for off := startOffset; off < startOffset+maxSearch; off++ {
		r.Seek(off, io.SeekStart)
		if _, err := io.ReadFull(r, buf); err != nil {
			return nil, 0
		}
		h := binary.BigEndian.Uint32(buf)
		if frame := parseFrameHeader(h); frame != nil {
			return frame, off
		}
	}
	return nil, 0
}

// oggDuration parses an OGG container to find total duration.
// Works by seeking to the end and reading the last OGG page's granule position.
func oggDuration(r io.ReadSeeker) float64 {
	// First, get the sample rate from the identification header
	// OGG page header: "OggS" (4 bytes), version (1), type (1), granule_pos (8),
	// serial (4), page_seq (4), checksum (4), segments (1), segment_table (n)
	var pageHeader [27]byte
	if _, err := io.ReadFull(r, pageHeader[:]); err != nil {
		return 0
	}
	if string(pageHeader[0:4]) != "OggS" {
		return 0
	}

	// Read segment table to find data length
	numSegments := int(pageHeader[26])
	segTable := make([]byte, numSegments)
	if _, err := io.ReadFull(r, segTable); err != nil {
		return 0
	}
	var dataLen int
	for _, s := range segTable {
		dataLen += int(s)
	}

	// Read the identification header data
	idData := make([]byte, dataLen)
	if _, err := io.ReadFull(r, idData); err != nil {
		return 0
	}

	var sampleRate uint32
	if len(idData) >= 12 && string(idData[1:7]) == "vorbis" {
		// Vorbis: sample rate at offset 12 (LE uint32)
		if len(idData) >= 16 {
			sampleRate = binary.LittleEndian.Uint32(idData[12:16])
		}
	} else if len(idData) >= 12 && string(idData[0:8]) == "OpusHead" {
		// Opus: always 48000 Hz for granule position
		sampleRate = 48000
	}

	if sampleRate == 0 {
		return 0
	}

	// Seek to end and search backwards for the last OGG page
	fileSize, _ := r.Seek(0, io.SeekEnd)
	searchSize := int64(65536)
	if searchSize > fileSize {
		searchSize = fileSize
	}
	r.Seek(fileSize-searchSize, io.SeekStart)
	buf := make([]byte, searchSize)
	n, _ := io.ReadFull(r, buf)
	buf = buf[:n]

	// Find last "OggS" sync
	lastOgg := -1
	for i := len(buf) - 4; i >= 0; i-- {
		if string(buf[i:i+4]) == "OggS" {
			lastOgg = i
			break
		}
	}
	if lastOgg < 0 || lastOgg+14 > len(buf) {
		return 0
	}

	// Granule position is at offset 6 in the page header (int64 LE)
	granule := binary.LittleEndian.Uint64(buf[lastOgg+6 : lastOgg+14])
	if granule == 0 || granule == 0xFFFFFFFFFFFFFFFF {
		return 0
	}

	return float64(granule) / float64(sampleRate)
}

// flacDuration parses a FLAC file's STREAMINFO metadata block to compute duration.
func flacDuration(r io.ReadSeeker) float64 {
	// FLAC starts with "fLaC" magic, then metadata blocks
	var magic [4]byte
	if _, err := io.ReadFull(r, magic[:]); err != nil {
		return 0
	}
	if string(magic[:]) != "fLaC" {
		return 0
	}

	// First metadata block must be STREAMINFO (type 0)
	var blockHeader [4]byte
	if _, err := io.ReadFull(r, blockHeader[:]); err != nil {
		return 0
	}

	blockType := blockHeader[0] & 0x7F // bit 7 = last-block flag
	if blockType != 0 {
		return 0 // not STREAMINFO
	}

	blockLen := int(blockHeader[1])<<16 | int(blockHeader[2])<<8 | int(blockHeader[3])
	if blockLen < 34 {
		return 0
	}

	block := make([]byte, blockLen)
	if _, err := io.ReadFull(r, block); err != nil {
		return 0
	}

	// STREAMINFO layout:
	// bytes 0-1: min block size
	// bytes 2-3: max block size
	// bytes 4-6: min frame size
	// bytes 7-9: max frame size
	// bytes 10-13: sample rate (20 bits) | channels (3 bits) | bps (5 bits) | total samples (4 bits)
	// bytes 14-17: total samples (low 32 bits)
	// bytes 18-33: MD5 signature

	// Sample rate: upper 20 bits of bytes 10-12
	sampleRate := uint32(block[10])<<12 | uint32(block[11])<<4 | uint32(block[12])>>4
	if sampleRate == 0 {
		return 0
	}

	// Total samples: lower 4 bits of byte 13 + bytes 14-17
	totalSamples := uint64(block[13]&0x0F)<<32 |
		uint64(block[14])<<24 | uint64(block[15])<<16 |
		uint64(block[16])<<8 | uint64(block[17])

	if totalSamples == 0 {
		return 0
	}

	return float64(totalSamples) / float64(sampleRate)
}

// mp4Duration parses an MP4/M4A container to find the duration from the mvhd atom.
func mp4Duration(r io.ReadSeeker) float64 {
	fileSize, _ := r.Seek(0, io.SeekEnd)
	r.Seek(0, io.SeekStart)

	// Recursively search for mvhd atom within moov atom
	return mp4SearchDuration(r, 0, fileSize)
}

func mp4SearchDuration(r io.ReadSeeker, start, end int64) float64 {
	pos := start
	var header [8]byte
	for pos < end {
		r.Seek(pos, io.SeekStart)
		if _, err := io.ReadFull(r, header[:]); err != nil {
			return 0
		}

		size := int64(binary.BigEndian.Uint32(header[0:4]))
		atomType := string(header[4:8])

		if size == 0 {
			size = end - pos
		} else if size == 1 {
			// Extended size
			var extSize [8]byte
			if _, err := io.ReadFull(r, extSize[:]); err != nil {
				return 0
			}
			size = int64(binary.BigEndian.Uint64(extSize[:]))
		}

		if size < 8 {
			return 0
		}

		if atomType == "mvhd" {
			return parseMvhd(r)
		}

		// Recurse into container atoms
		if atomType == "moov" || atomType == "trak" || atomType == "mdia" || atomType == "minf" || atomType == "stbl" {
			if dur := mp4SearchDuration(r, pos+8, pos+size); dur > 0 {
				return dur
			}
		}

		pos += size
	}
	return 0
}

func parseMvhd(r io.ReadSeeker) float64 {
	// mvhd starts with version (1 byte) + flags (3 bytes)
	var versionFlags [4]byte
	if _, err := io.ReadFull(r, versionFlags[:]); err != nil {
		return 0
	}
	version := versionFlags[0]

	if version == 0 {
		// Version 0: create_time(4) + mod_time(4) + timescale(4) + duration(4)
		var data [16]byte
		if _, err := io.ReadFull(r, data[:]); err != nil {
			return 0
		}
		timescale := binary.BigEndian.Uint32(data[8:12])
		duration := binary.BigEndian.Uint32(data[12:16])
		if timescale == 0 {
			return 0
		}
		return float64(duration) / float64(timescale)
	} else if version == 1 {
		// Version 1: create_time(8) + mod_time(8) + timescale(4) + duration(8)
		var data [28]byte
		if _, err := io.ReadFull(r, data[:]); err != nil {
			return 0
		}
		timescale := binary.BigEndian.Uint32(data[16:20])
		duration := binary.BigEndian.Uint64(data[20:28])
		if timescale == 0 {
			return 0
		}
		return float64(duration) / float64(timescale)
	}

	return 0
}

func findXingFrames(r io.ReadSeeker, frameOffset int64, frame *mp3Frame) int {
	// Xing header is at a fixed offset into the first frame, after the side information
	var sideInfoSize int
	if frame.version == 1 {
		sideInfoSize = 32 // stereo; mono would be 17, but 32 is safe to search from
	} else {
		sideInfoSize = 17
	}

	// Read enough of the first frame to find Xing/Info header
	buf := make([]byte, frame.frameSize)
	r.Seek(frameOffset, io.SeekStart)
	if _, err := io.ReadFull(r, buf); err != nil {
		return 0
	}

	// Search for "Xing" or "Info" tag within the frame
	for i := sideInfoSize; i < len(buf)-8; i++ {
		tag := string(buf[i : i+4])
		if tag == "Xing" || tag == "Info" {
			flags := binary.BigEndian.Uint32(buf[i+4 : i+8])
			if flags&1 != 0 && i+12 <= len(buf) { // frames field present
				return int(binary.BigEndian.Uint32(buf[i+8 : i+12]))
			}
			return 0
		}
	}
	return 0
}
