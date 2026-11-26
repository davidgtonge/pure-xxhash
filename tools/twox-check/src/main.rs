use twox_hash::{XxHash32, XxHash3_128, XxHash3_64, XxHash64};

const EXTRA_LENGTHS: [usize; 19] = [
    384, 512, 777, 1000, 1023, 1024, 1025, 2047, 2048, 4095, 4096, 4097, 10000, 65535, 65536, 65537, 100003, 1048576, 1048577,
];
const SEEDS32: [u32; 5] = [0, 1, 12345, 0x9E3779B1, 0xFFFFFFFF];
const SEEDS64: [u64; 6] = [0, 1, 12345, 0x100000000, 0x9E3779B185EBCA8D, 0xFFFFFFFFFFFFFFFF];
const SECRETS: [(usize, usize); 3] = [(7, 136), (3, 200), (11, 1024)];

fn main() {
    let mut buffer = vec![0u8; 1048577 + 64];
    let mut generator: u64 = 2654435761;
    for byte in buffer.iter_mut() {
        *byte = (generator >> 56) as u8;
        generator = generator.wrapping_mul(11400714785074694797);
    }
    let lengths = (0..=300).chain(EXTRA_LENGTHS.iter().copied());
    for length in lengths {
        let input = &buffer[..length];
        for seed in SEEDS32 {
            println!("xxh32 {} {:x} {:08x}", length, seed, XxHash32::oneshot(seed, input));
        }
        for seed in SEEDS64 {
            println!("xxh64 {} {:x} {:016x}", length, seed, XxHash64::oneshot(seed, input));
        }
        for seed in SEEDS64 {
            println!("xxh3 {} {:x} {:016x}", length, seed, XxHash3_64::oneshot_with_seed(seed, input));
            println!("xxh128 {} {:x} {:032x}", length, seed, XxHash3_128::oneshot_with_seed(seed, input));
        }
        for (offset, size) in SECRETS {
            let secret = &buffer[offset..offset + size];
            println!("xxh3 {} secret{}@{} {:016x}", length, size, offset, XxHash3_64::oneshot_with_secret(secret, input).unwrap());
            println!("xxh128 {} secret{}@{} {:032x}", length, size, offset, XxHash3_128::oneshot_with_secret(secret, input).unwrap());
        }
    }
}
