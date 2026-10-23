// Portable documents admit real calendar dates and explicit UTC instants only.
// Keeping the spelling intact preserves legacy fractional precision on save.
pub fn date(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let Some(year) = number(&b[..4]) else {
        return false;
    };
    let Some(month) = number(&b[5..7]) else {
        return false;
    };
    let Some(day) = number(&b[8..]) else {
        return false;
    };
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

pub fn instant(value: &str) -> bool {
    let Some(body) = value
        .strip_suffix('Z')
        .or_else(|| value.strip_suffix("+00:00"))
    else {
        return false;
    };
    let b = body.as_bytes();
    if b.len() < 19
        || !body.is_ascii()
        || !date(&body[..10])
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
    {
        return false;
    }
    if !number(&b[11..13]).is_some_and(|n| n < 24)
        || !number(&b[14..16]).is_some_and(|n| n < 60)
        || !number(&b[17..19]).is_some_and(|n| n < 60)
    {
        return false;
    }
    b.len() == 19 || ((21..=27).contains(&b.len()) && b[19] == b'.' && number(&b[20..]).is_some())
}

fn number(bytes: &[u8]) -> Option<u32> {
    bytes.iter().try_fold(0, |value, b| {
        b.is_ascii_digit().then(|| value * 10 + u32::from(b - b'0'))
    })
}
