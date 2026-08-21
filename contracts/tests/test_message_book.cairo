use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
use strk20_app::message_book::{IMessageBookDispatcher, IMessageBookDispatcherTrait};

const MODE_APPEND: felt252 = 1;
const MODE_SEAL: felt252 = 2;

fn deploy() -> IMessageBookDispatcher {
    let contract = declare("MessageBook").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    IMessageBookDispatcher { contract_address: addr }
}

#[test]
fn append_returns_an_empty_deposit_span() {
    let mb = deploy();
    let deposits = mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xAA, 0xBB].span());
    assert(deposits.len() == 0, 'must return zero deposits');
}

#[test]
fn append_increments_the_per_tag_counter() {
    let mb = deploy();
    assert(mb.message_count('tag1') == 0, 'starts empty');
    mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xAA].span());
    mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xBB].span());
    assert(mb.message_count('tag1') == 2, 'counts to 2');
    assert(mb.message_count('tag2') == 0, 'tags are independent');
}

#[test]
fn seal_stores_the_root_and_leaves_the_counter_alone() {
    let mb = deploy();
    mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xAA].span());
    mb.privacy_invoke(MODE_SEAL, 'tag1', array![0xB0B].span());
    assert(mb.seal_root('tag1') == 0xB0B, 'root stored');
    assert(mb.message_count('tag1') == 1, 'seal is not a message');
}

#[test]
#[should_panic(expected: 'UNKNOWN_MODE')]
fn unknown_mode_panics() {
    deploy().privacy_invoke(99, 'tag1', array![0xAA].span());
}

#[test]
#[should_panic(expected: 'EMPTY_PAYLOAD')]
fn empty_payload_panics() {
    deploy().privacy_invoke(MODE_APPEND, 'tag1', array![].span());
}

#[test]
#[should_panic(expected: 'SEAL_NEEDS_ONE_FELT')]
fn seal_with_multiple_felts_panics() {
    deploy().privacy_invoke(MODE_SEAL, 'tag1', array![0x1, 0x2].span());
}
