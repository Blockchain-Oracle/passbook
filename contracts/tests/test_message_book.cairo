use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, spy_events, EventSpyAssertionsTrait,
};
use strk20_app::message_book::{IMessageBookDispatcher, IMessageBookDispatcherTrait, MessageBook};

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

// The message body is carried ONLY by the event -- it is never written to storage. A contract
// that bumped the counter and stored the seal root but silently dropped its `emit` would still
// satisfy every counter/return assertion above, and the chat surface would deliver nothing.
// These tests are what make that refactor fail.

#[test]
fn append_emits_message_appended_carrying_the_payload() {
    let mb = deploy();
    let mut spy = spy_events();

    mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xAA, 0xBB].span());

    spy
        .assert_emitted(
            @array![
                (
                    mb.contract_address,
                    MessageBook::Event::MessageAppended(
                        MessageBook::MessageAppended {
                            tag: 'tag1', index: 0, ciphertext: array![0xAA, 0xBB].span(),
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn each_append_emits_its_own_index_and_body() {
    let mb = deploy();
    let mut spy = spy_events();

    mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xAA].span());
    mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xCC, 0xDD].span());

    spy
        .assert_emitted(
            @array![
                (
                    mb.contract_address,
                    MessageBook::Event::MessageAppended(
                        MessageBook::MessageAppended {
                            tag: 'tag1', index: 0, ciphertext: array![0xAA].span(),
                        },
                    ),
                ),
                (
                    mb.contract_address,
                    MessageBook::Event::MessageAppended(
                        MessageBook::MessageAppended {
                            tag: 'tag1', index: 1, ciphertext: array![0xCC, 0xDD].span(),
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn seal_emits_conversation_sealed_with_root_and_count() {
    let mb = deploy();
    mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xAA].span());
    mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xBB].span());

    let mut spy = spy_events();
    mb.privacy_invoke(MODE_SEAL, 'tag1', array![0xB0B].span());

    spy
        .assert_emitted(
            @array![
                (
                    mb.contract_address,
                    MessageBook::Event::ConversationSealed(
                        MessageBook::ConversationSealed { tag: 'tag1', root: 0xB0B, count: 2 },
                    ),
                ),
            ],
        );
}

// The pool deserializes our return data straight into `Span<OpenNoteDeposit>` and then asserts
// the buffer is empty, so a tuple return reverts on the deployed class. Lock the shape in on
// the seal path too, not just append.
#[test]
fn seal_returns_an_empty_deposit_span() {
    let mb = deploy();
    let deposits = mb.privacy_invoke(MODE_SEAL, 'tag1', array![0xB0B].span());
    assert(deposits.len() == 0, 'must return zero deposits');
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
