package resolve

func ShouldRejectDistance(distanceKM, maxKM float64, isTrace bool, allowLongTrace bool, hasTraceEvidence bool) bool {
	if maxKM <= 0 {
		return false
	}
	if distanceKM <= maxKM {
		return false
	}
	if isTrace && allowLongTrace {
		return false
	}
	return true
}
